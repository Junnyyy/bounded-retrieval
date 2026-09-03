import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { MessageRecord } from "../domain/message.ts";
import type { NormalizedQuery } from "./query.ts";
import { toFtsQuery } from "./query.ts";
import {
  MESSAGE_SELECT_COLUMNS,
  rowToMessage,
  type MessageRow,
} from "./rows.ts";

interface CandidateQuery {
  readonly parameters: readonly SQLInputValue[];
  readonly sql: string;
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

export function buildCandidateQuery(
  query: NormalizedQuery,
  options: { readonly ranked?: boolean } = {},
): CandidateQuery {
  const filters = query.filters;
  const predicates = ["messages_fts MATCH ?"];
  const parameters: SQLInputValue[] = [toFtsQuery(query)];

  const addListFilter = (
    column: string,
    values: readonly string[],
  ): void => {
    if (values.length > 0) {
      predicates.push(`${column} IN (${placeholders(values)})`);
      parameters.push(...values);
    }
  };
  addListFilter("messages.conversation_id", filters.conversationIds);
  addListFilter("messages.conversation_type", filters.conversationTypes);
  addListFilter("messages.sender_id", filters.senderIds);
  addListFilter("messages.sender_type", filters.senderTypes);
  if (filters.threadIds.length > 0) {
    predicates.push(
      `COALESCE(messages.thread_root_message_id, messages.message_id) IN (${placeholders(filters.threadIds)})`,
    );
    parameters.push(...filters.threadIds);
  }
  if (filters.fromInclusive !== null) {
    predicates.push("messages.sent_at >= ?");
    parameters.push(filters.fromInclusive);
  }
  if (filters.toExclusive !== null) {
    predicates.push("messages.sent_at < ?");
    parameters.push(filters.toExclusive);
  }

  const rankColumn = options.ranked
    ? ", bm25(messages_fts) AS rank"
    : "";
  const ordering = options.ranked
    ? "rank, messages.sent_at, messages.message_id"
    : "messages.sent_at, messages.message_id";
  return {
    parameters,
    sql: `
      SELECT ${MESSAGE_SELECT_COLUMNS}${rankColumn}
      FROM messages_fts
      JOIN messages ON messages.rowid = messages_fts.rowid
      WHERE ${predicates.join(" AND ")}
      ORDER BY ${ordering}
    `,
  };
}

export function iterateCandidates(
  database: DatabaseSync,
  query: NormalizedQuery,
  options: { readonly ranked?: boolean } = {},
): Iterable<{ readonly message: MessageRecord; readonly rank: number | null }> {
  const candidateQuery = buildCandidateQuery(query, options);
  const rows = database
    .prepare(candidateQuery.sql)
    .iterate(...candidateQuery.parameters) as Iterable<MessageRow>;

  return {
    *[Symbol.iterator]() {
      for (const row of rows) {
        yield {
          message: rowToMessage(row),
          rank: row.rank ?? null,
        };
      }
    },
  };
}
