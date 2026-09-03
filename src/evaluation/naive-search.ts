import { performance } from "node:perf_hooks";
import type { DatabaseSync } from "node:sqlite";

import { serializedBytes } from "../budget/limits.ts";
import type { MessageRecord } from "../domain/message.ts";
import {
  MESSAGE_SELECT_COLUMNS,
  rowToMessage,
  type MessageRow,
} from "../retrieval/rows.ts";

export interface NaiveRegexResult {
  readonly candidateRowsExamined: number;
  readonly durationMilliseconds: number;
  readonly matchingMessages: number;
  readonly mcpResultBytes: number;
  readonly occurrences: number;
  readonly result: {
    readonly messages: readonly MessageRecord[];
    readonly pattern: string;
  };
}

/**
 * Evaluation-only baseline. It deliberately scans the flat table and returns
 * every matching denormalized row in one model-visible result.
 */
export function naiveRegexSearch(
  database: DatabaseSync,
  pattern: RegExp,
): NaiveRegexResult {
  if (!pattern.global) {
    throw new Error("The naive evaluation pattern must use the global flag");
  }

  const startedAt = performance.now();
  const rows = database
    .prepare(
      `SELECT ${MESSAGE_SELECT_COLUMNS} FROM messages ORDER BY sent_at, message_id`,
    )
    .iterate() as Iterable<MessageRow>;
  const messages: MessageRecord[] = [];
  let candidateRowsExamined = 0;
  let occurrences = 0;

  for (const row of rows) {
    candidateRowsExamined += 1;
    pattern.lastIndex = 0;
    const matches = Array.from(row.text.matchAll(pattern));
    if (matches.length === 0) continue;
    occurrences += matches.length;
    messages.push(rowToMessage(row));
  }

  const result = { messages, pattern: pattern.source };
  const mcpResult = {
    content: [{ text: JSON.stringify(result), type: "text" as const }],
    structuredContent: result,
  };

  return {
    candidateRowsExamined,
    durationMilliseconds: performance.now() - startedAt,
    matchingMessages: messages.length,
    mcpResultBytes: serializedBytes(mcpResult),
    occurrences,
    result,
  };
}
