import type { MessageRecord } from "../domain/message.ts";
import { threadIdentity } from "../domain/message.ts";
import {
  compileQueryClauses,
  matchText,
  type CompiledClause,
  type NormalizedQuery,
} from "./query.ts";
import {
  conversationReference,
  messageReference,
  threadReference,
} from "./references.ts";

export interface EvidenceRecord {
  readonly conversation: {
    readonly id: string;
    readonly name: string;
    readonly ref: string;
    readonly type: MessageRecord["conversationType"];
  };
  readonly matchedRoles: readonly ("alias" | "canonical")[];
  readonly messageId: string;
  readonly messageRef: string;
  readonly rank: number | null;
  readonly sender: {
    readonly id: string;
    readonly name: string;
    readonly organization: string;
    readonly type: MessageRecord["senderType"];
  };
  readonly sentAt: string;
  readonly snippet: string;
  readonly snippetClipped: boolean;
  readonly threadRef: string;
}

export interface ContextMessage {
  readonly messageId: string;
  readonly messageRef: string;
  readonly replyToMessageId: string | null;
  readonly sender: {
    readonly id: string;
    readonly name: string;
    readonly organization: string;
    readonly type: MessageRecord["senderType"];
  };
  readonly sentAt: string;
  readonly text: string;
  readonly textClipped: boolean;
}

function clipAround(
  text: string,
  offset: number,
  maximumCharacters: number,
): { readonly clipped: boolean; readonly value: string } {
  if (text.length <= maximumCharacters) {
    return { clipped: false, value: text };
  }

  const half = Math.floor(maximumCharacters / 2);
  let start = Math.max(0, offset - half);
  let end = Math.min(text.length, start + maximumCharacters);
  start = Math.max(0, end - maximumCharacters);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const available = maximumCharacters - prefix.length - suffix.length;
  end = Math.min(text.length, start + Math.max(0, available));
  return { clipped: true, value: `${prefix}${text.slice(start, end)}${suffix}` };
}

export function toEvidence(
  message: MessageRecord,
  options: {
    readonly clauses: readonly CompiledClause[];
    readonly corpusVersion: string;
    readonly maximumSnippetCharacters: number;
    readonly query: NormalizedQuery;
    readonly rank: number | null;
  },
): EvidenceRecord | null {
  const matches = matchText(message.text, options.clauses, options.query.combine);
  if (matches === null) {
    return null;
  }
  const snippet = clipAround(
    message.text,
    Math.min(...matches.map((match) => match.firstOffset)),
    options.maximumSnippetCharacters,
  );
  const threadId = threadIdentity(message);

  return {
    conversation: {
      id: message.conversationId,
      name: message.conversationName,
      ref: conversationReference(options.corpusVersion, message.conversationId),
      type: message.conversationType,
    },
    matchedRoles: Array.from(
      new Set(matches.map((match) => match.clause.role)),
    ).sort(),
    messageId: message.messageId,
    messageRef: messageReference(options.corpusVersion, message.messageId),
    rank: options.rank,
    sender: {
      id: message.senderId,
      name: message.senderName,
      organization: message.senderOrganization,
      type: message.senderType,
    },
    sentAt: new Date(message.sentAt).toISOString(),
    snippet: snippet.value,
    snippetClipped: snippet.clipped,
    threadRef: threadReference(options.corpusVersion, threadId),
  };
}

export function toContextMessage(
  message: MessageRecord,
  corpusVersion: string,
  maximumTextCharacters: number,
): ContextMessage {
  const clipped = clipAround(message.text, 0, maximumTextCharacters);
  return {
    messageId: message.messageId,
    messageRef: messageReference(corpusVersion, message.messageId),
    replyToMessageId: message.replyToMessageId,
    sender: {
      id: message.senderId,
      name: message.senderName,
      organization: message.senderOrganization,
      type: message.senderType,
    },
    sentAt: new Date(message.sentAt).toISOString(),
    text: clipped.value,
    textClipped: clipped.clipped,
  };
}

export function evidenceCompiler(query: NormalizedQuery): readonly CompiledClause[] {
  return compileQueryClauses(query);
}
