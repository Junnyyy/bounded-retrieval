import type { ExportResult } from "../export/export-messages.ts";
import type { ContextMessage, EvidenceRecord } from "../retrieval/evidence.ts";
import type { NormalizedQuery } from "../retrieval/query.ts";

export function serializeQuery(query: NormalizedQuery) {
  return {
    clauses: query.clauses,
    combine: query.combine,
    filters: {
      conversation_ids: query.filters.conversationIds,
      conversation_types: query.filters.conversationTypes,
      from_inclusive: query.filters.fromInclusive,
      sender_ids: query.filters.senderIds,
      sender_types: query.filters.senderTypes,
      thread_ids: query.filters.threadIds,
      to_exclusive: query.filters.toExclusive,
    },
  };
}

export function serializeEvidence(evidence: EvidenceRecord) {
  return {
    conversation: evidence.conversation,
    matched_roles: evidence.matchedRoles,
    message_id: evidence.messageId,
    message_ref: evidence.messageRef,
    rank: evidence.rank,
    sender: evidence.sender,
    sent_at: evidence.sentAt,
    snippet: evidence.snippet,
    snippet_clipped: evidence.snippetClipped,
    thread_ref: evidence.threadRef,
  };
}

export function serializeContextMessage(message: ContextMessage) {
  return {
    message_id: message.messageId,
    message_ref: message.messageRef,
    reply_to_message_id: message.replyToMessageId,
    sender: message.sender,
    sent_at: message.sentAt,
    text: message.text,
    text_clipped: message.textClipped,
  };
}

export function serializeExport(exported: ExportResult) {
  if (exported.outcome === "incomplete") {
    return {
      candidate_rows_examined: exported.candidateRowsExamined,
      outcome: exported.outcome,
      reason: exported.reason,
    };
  }
  return {
    artifact_path: exported.artifactPath,
    bytes: exported.bytes,
    corpus_version: exported.corpusVersion,
    format: exported.format,
    message_ids_sha256: exported.messageIdsSha256,
    mime_type: exported.mimeType,
    outcome: exported.outcome,
    rows: exported.rows,
    sha256: exported.sha256,
  };
}
