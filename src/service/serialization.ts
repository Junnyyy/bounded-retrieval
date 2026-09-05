import type { ExportResult } from "../export/export-messages.ts";
import type { ContextMessage, EvidenceRecord } from "../retrieval/evidence.ts";
import type { NormalizedQuery } from "../retrieval/query.ts";

export function serializeQuery(query: NormalizedQuery) {
  const filters = {
    ...(query.filters.conversationIds.length === 0 ? {} : { conversation_ids: query.filters.conversationIds }),
    ...(query.filters.conversationTypes.length === 0 ? {} : { conversation_types: query.filters.conversationTypes }),
    ...(query.filters.fromInclusive === null ? {} : { from_inclusive: query.filters.fromInclusive }),
    ...(query.filters.senderIds.length === 0 ? {} : { sender_ids: query.filters.senderIds }),
    ...(query.filters.senderTypes.length === 0 ? {} : { sender_types: query.filters.senderTypes }),
    ...(query.filters.threadIds.length === 0 ? {} : { thread_ids: query.filters.threadIds }),
    ...(query.filters.toExclusive === null ? {} : { to_exclusive: query.filters.toExclusive }),
  };
  return {
    clauses: query.clauses,
    combine: query.combine,
    ...(Object.keys(filters).length === 0 ? {} : { filters }),
  };
}

export function serializeEvidence(evidence: EvidenceRecord) {
  return {
    conversation: {
      id: evidence.conversation.id,
      name: evidence.conversation.name,
      type: evidence.conversation.type,
    },
    matched_roles: evidence.matchedRoles,
    message_ref: evidence.messageRef,
    sender: evidence.sender,
    sent_at: evidence.sentAt,
    snippet: evidence.snippet,
    snippet_clipped: evidence.snippetClipped,
    thread_ref: evidence.threadRef,
    ...(evidence.sameTextMatches === undefined ? {} : { same_text_matches: evidence.sameTextMatches }),
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
