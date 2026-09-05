import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { readCorpusMetadata } from "../database/corpus.ts";
import type { MessageRecord } from "../domain/message.ts";
import { toContextMessage, type ContextMessage } from "./evidence.ts";
import {
  MESSAGE_SELECT_COLUMNS,
  rowToMessage,
  type MessageRow,
} from "./rows.ts";

export const MAX_CONTEXT_MESSAGES = 20;
export const MAX_CONTEXT_MESSAGE_CHARACTERS = 1_000;

export interface ContextResult {
  readonly anchorMessageId: string;
  readonly clippedAfter: boolean;
  readonly clippedBefore: boolean;
  readonly contextKind: "conversation" | "thread";
  readonly messages: readonly ContextMessage[];
  readonly totalMessages: number;
  readonly rootMessageId: string | null;
}

function getMessage(database: DatabaseSync, messageId: string): MessageRecord {
  const row = database
    .prepare(`SELECT ${MESSAGE_SELECT_COLUMNS} FROM messages WHERE message_id = ?`)
    .get(messageId) as MessageRow | undefined;
  if (row === undefined) {
    throw new Error(`Unknown message ${JSON.stringify(messageId)}`);
  }
  return rowToMessage(row);
}

function getRows(
  database: DatabaseSync,
  sql: string,
  parameters: readonly SQLInputValue[],
): readonly MessageRecord[] {
  return (
    database.prepare(sql).all(...parameters) as unknown as readonly MessageRow[]
  ).map(rowToMessage);
}

function getCount(
  database: DatabaseSync,
  sql: string,
  parameters: readonly SQLInputValue[],
): number {
  const row = database.prepare(sql).get(...parameters) as { count: number };
  return row.count;
}

function beforePredicate(): string {
  return "(sent_at < ? OR (sent_at = ? AND message_id < ?))";
}

function afterPredicate(): string {
  return "(sent_at > ? OR (sent_at = ? AND message_id > ?))";
}

export function expandMessageContext(
  database: DatabaseSync,
  messageId: string,
  requestedLimit = MAX_CONTEXT_MESSAGES,
): ContextResult {
  const metadata = readCorpusMetadata(database);
  const anchor = getMessage(database, messageId);
  const limit = Math.max(1, Math.min(requestedLimit, MAX_CONTEXT_MESSAGES));
  const possibleRootId = anchor.threadRootMessageId ?? anchor.messageId;
  const replyCount = getCount(
    database,
    "SELECT COUNT(*) AS count FROM messages WHERE thread_root_message_id = ?",
    [possibleRootId],
  );
  const contextKind =
    anchor.threadRootMessageId !== null || replyCount > 0 ? "thread" : "conversation";
  const scopePredicate =
    contextKind === "thread"
      ? "(message_id = ? OR thread_root_message_id = ?)"
      : "conversation_id = ?";
  const scopeParameters: SQLInputValue[] =
    contextKind === "thread"
      ? [possibleRootId, possibleRootId]
      : [anchor.conversationId];
  const anchorParameters: SQLInputValue[] = [
    anchor.sentAt,
    anchor.sentAt,
    anchor.messageId,
  ];
  const root =
    contextKind === "thread" && possibleRootId !== anchor.messageId
      ? getMessage(database, possibleRootId)
      : null;
  const reserved = new Map<string, MessageRecord>();
  reserved.set(anchor.messageId, anchor);
  if (root !== null && limit > 1) reserved.set(root.messageId, root);
  const remaining = Math.max(0, limit - reserved.size);
  const rootExclusion = root === null ? "" : "AND message_id <> ?";
  const rootParameters: SQLInputValue[] =
    root === null ? [] : [root.messageId];
  const availableBefore = getRows(
    database,
    `
      SELECT ${MESSAGE_SELECT_COLUMNS}
      FROM messages
      WHERE ${scopePredicate} AND ${beforePredicate()} ${rootExclusion}
      ORDER BY sent_at DESC, message_id DESC
      LIMIT ?
    `,
    [...scopeParameters, ...anchorParameters, ...rootParameters, remaining],
  );
  const availableAfter = getRows(
    database,
    `
      SELECT ${MESSAGE_SELECT_COLUMNS}
      FROM messages
      WHERE ${scopePredicate} AND ${afterPredicate()} ${rootExclusion}
      ORDER BY sent_at, message_id
      LIMIT ?
    `,
    [...scopeParameters, ...anchorParameters, ...rootParameters, remaining],
  );
  let beforeSize = Math.min(availableBefore.length, Math.floor(remaining / 2));
  let afterSize = Math.min(availableAfter.length, remaining - beforeSize);
  beforeSize = Math.min(availableBefore.length, remaining - afterSize);
  afterSize = Math.min(availableAfter.length, remaining - beforeSize);
  const before = availableBefore.slice(0, beforeSize);
  const after = availableAfter.slice(0, afterSize);
  for (const message of [...before, ...after]) {
    if (reserved.size < limit) reserved.set(message.messageId, message);
  }
  const messages = Array.from(reserved.values()).sort(
    (left, right) =>
      left.sentAt - right.sentAt || left.messageId.localeCompare(right.messageId),
  );
  const beforeCount = getCount(
    database,
    `SELECT COUNT(*) AS count FROM messages WHERE ${scopePredicate} AND ${beforePredicate()} ${rootExclusion}`,
    [...scopeParameters, ...anchorParameters, ...rootParameters],
  );
  const afterCount = getCount(
    database,
    `SELECT COUNT(*) AS count FROM messages WHERE ${scopePredicate} AND ${afterPredicate()} ${rootExclusion}`,
    [...scopeParameters, ...anchorParameters, ...rootParameters],
  );

  return {
    anchorMessageId: anchor.messageId,
    clippedAfter: afterCount > after.length,
    clippedBefore: beforeCount > before.length || (root !== null && !reserved.has(root.messageId)),
    contextKind,
    messages: messages.map((message) =>
      toContextMessage(message, metadata.version, MAX_CONTEXT_MESSAGE_CHARACTERS),
    ),
    totalMessages: 1 + Number(root !== null) + beforeCount + afterCount,
    rootMessageId: contextKind === "thread" ? possibleRootId : null,
  };
}
