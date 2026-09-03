import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { DatabaseSync } from "node:sqlite";

import { readCorpusMetadata } from "../database/corpus.ts";
import type { MessageRecord } from "../domain/message.ts";
import { iterateCandidates } from "../retrieval/candidates.ts";
import {
  compileQueryClauses,
  matchText,
  queryDigest,
  type NormalizedQuery,
} from "../retrieval/query.ts";

const EXPORT_BUFFER_BYTES = 1_048_576;

export interface ExportLimits {
  readonly maxCandidateRows: number;
  readonly maxMilliseconds: number;
}

export const DEFAULT_EXPORT_LIMITS: ExportLimits = {
  maxCandidateRows: 20_000_000,
  maxMilliseconds: 60_000,
};

export interface ExportCompleteResult {
  readonly artifactPath: string;
  readonly bytes: number;
  readonly corpusVersion: string;
  readonly format: "jsonl";
  readonly messageIdsSha256: string;
  readonly mimeType: "application/x-ndjson";
  readonly outcome: "complete";
  readonly rows: number;
  readonly sha256: string;
}

export interface ExportIncompleteResult {
  readonly candidateRowsExamined: number;
  readonly outcome: "incomplete";
  readonly reason: "candidate_limit" | "time_limit";
}

export type ExportResult = ExportCompleteResult | ExportIncompleteResult;

function exportRow(message: MessageRecord): Readonly<Record<string, unknown>> {
  return {
    message_id: message.messageId,
    workspace_id: message.workspaceId,
    conversation_id: message.conversationId,
    conversation_name: message.conversationName,
    conversation_type: message.conversationType,
    sender_id: message.senderId,
    sender_name: message.senderName,
    sender_type: message.senderType,
    sender_organization: message.senderOrganization,
    sent_at: new Date(message.sentAt).toISOString(),
    text: message.text,
    thread_root_message_id: message.threadRootMessageId,
    reply_to_message_id: message.replyToMessageId,
  };
}

export function exportMessages(
  database: DatabaseSync,
  query: NormalizedQuery,
  artifactDirectory: string,
  limits: ExportLimits = DEFAULT_EXPORT_LIMITS,
): ExportResult {
  const metadata = readCorpusMetadata(database);
  const artifactPath = resolve(
    artifactDirectory,
    `messages-${metadata.version}-${queryDigest(query).slice(0, 16)}.jsonl`,
  );
  mkdirSync(resolve(artifactDirectory), { recursive: true });
  const descriptor = openSync(artifactPath, "w", 0o600);
  const contentDigest = createHash("sha256");
  const messageIdDigest = createHash("sha256");
  const clauses = compileQueryClauses(query);
  const startedAt = performance.now();
  let buffer = "";
  let candidateRowsExamined = 0;
  let rows = 0;
  let incompleteReason: ExportIncompleteResult["reason"] | null = null;

  const flush = (): void => {
    if (buffer === "") return;
    writeSync(descriptor, buffer, undefined, "utf8");
    contentDigest.update(buffer, "utf8");
    buffer = "";
  };

  try {
    for (const candidate of iterateCandidates(database, query)) {
      candidateRowsExamined += 1;
      if (candidateRowsExamined > limits.maxCandidateRows) {
        incompleteReason = "candidate_limit";
        break;
      }
      if (performance.now() - startedAt > limits.maxMilliseconds) {
        incompleteReason = "time_limit";
        break;
      }
      if (matchText(candidate.message.text, clauses, query.combine) === null) {
        continue;
      }

      const line = `${JSON.stringify(exportRow(candidate.message))}\n`;
      buffer += line;
      messageIdDigest.update(`${candidate.message.messageId}\n`);
      rows += 1;
      if (Buffer.byteLength(buffer, "utf8") >= EXPORT_BUFFER_BYTES) flush();
    }
    flush();
  } finally {
    closeSync(descriptor);
  }

  if (incompleteReason !== null) {
    unlinkSync(artifactPath);
    return {
      candidateRowsExamined,
      outcome: "incomplete",
      reason: incompleteReason,
    };
  }

  return {
    artifactPath,
    bytes: statSync(artifactPath).size,
    corpusVersion: metadata.version,
    format: "jsonl",
    messageIdsSha256: messageIdDigest.digest("hex"),
    mimeType: "application/x-ndjson",
    outcome: "complete",
    rows,
    sha256: contentDigest.digest("hex"),
  };
}
