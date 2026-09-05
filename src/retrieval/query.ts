import { createHash } from "node:crypto";

import {
  CONVERSATION_TYPES,
  SENDER_TYPES,
  type ConversationType,
  type SenderType,
} from "../domain/message.ts";

export const MATCH_MODES = ["literal", "phrase", "prefix"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const CLAUSE_ROLES = ["canonical", "alias"] as const;
export type ClauseRole = (typeof CLAUSE_ROLES)[number];

export interface QueryClause {
  readonly match: MatchMode;
  readonly role: ClauseRole;
  readonly text: string;
}

export interface QueryFilters {
  readonly conversationIds?: readonly string[];
  readonly conversationTypes?: readonly ConversationType[];
  readonly fromInclusive?: number | null;
  readonly senderIds?: readonly string[];
  readonly senderTypes?: readonly SenderType[];
  readonly threadIds?: readonly string[];
  readonly toExclusive?: number | null;
}

export interface StructuredQuery {
  readonly clauses: readonly QueryClause[];
  readonly combine: "all" | "any";
  readonly filters?: QueryFilters;
}

export interface NormalizedQuery {
  readonly clauses: readonly QueryClause[];
  readonly combine: "all" | "any";
  readonly filters: {
    readonly conversationIds: readonly string[];
    readonly conversationTypes: readonly ConversationType[];
    readonly fromInclusive: number | null;
    readonly senderIds: readonly string[];
    readonly senderTypes: readonly SenderType[];
    readonly threadIds: readonly string[];
    readonly toExclusive: number | null;
  };
}

const MAX_CLAUSES = 8;
const MAX_CLAUSE_LENGTH = 128;
const MAX_FILTER_VALUES = 100;

function sortedUnique(values: readonly string[] | undefined): readonly string[] {
  return Array.from(
    new Set(
      (values ?? []).map((value) => value.trim()).filter((value) => value !== ""),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeEnumValues<Value extends string>(
  values: readonly string[] | undefined,
  allowed: readonly Value[],
  name: string,
): readonly Value[] {
  const normalized = sortedUnique(values);
  for (const value of normalized) {
    if (!allowed.includes(value as Value)) {
      throw new Error(`${name} contains unsupported value ${JSON.stringify(value)}`);
    }
  }
  return normalized as readonly Value[];
}

function assertFilterSize(name: string, values: readonly string[]): void {
  if (values.length > MAX_FILTER_VALUES) {
    throw new Error(`${name} may contain at most ${MAX_FILTER_VALUES} values`);
  }
}

export function normalizeQuery(
  query: StructuredQuery | NormalizedQuery,
): NormalizedQuery {
  if (query.combine !== "all" && query.combine !== "any") {
    throw new Error('Query combine must be either "all" or "any"');
  }
  if (query.clauses.length === 0 || query.clauses.length > MAX_CLAUSES) {
    throw new Error(`Query must contain between 1 and ${MAX_CLAUSES} clauses`);
  }

  const clauseMap = new Map<string, QueryClause>();
  for (const clause of query.clauses) {
    const text = clause.text.trim();
    if (text === "" || text.length > MAX_CLAUSE_LENGTH) {
      throw new Error(
        `Clause text must contain between 1 and ${MAX_CLAUSE_LENGTH} characters`,
      );
    }
    if (!/[\p{L}\p{N}]/u.test(text)) {
      throw new Error("Clause text must contain at least one letter or number");
    }
    if (!MATCH_MODES.includes(clause.match)) {
      throw new Error(`Unsupported match mode ${JSON.stringify(clause.match)}`);
    }
    if (!CLAUSE_ROLES.includes(clause.role)) {
      throw new Error(`Unsupported clause role ${JSON.stringify(clause.role)}`);
    }
    if (clause.match === "prefix" && !/^[\p{L}\p{N}]+$/u.test(text)) {
      throw new Error("Prefix clauses must contain exactly one letter/number token");
    }

    const normalizedText = text.toLocaleLowerCase("en-US");
    const normalizedClause = { ...clause, text: normalizedText };
    const key = `${clause.role}\u0000${clause.match}\u0000${normalizedText}`;
    clauseMap.set(key, normalizedClause);
  }

  const clauses = Array.from(clauseMap.values()).sort((left, right) =>
    `${left.role}:${left.match}:${left.text.toLocaleLowerCase("en-US")}`.localeCompare(
      `${right.role}:${right.match}:${right.text.toLocaleLowerCase("en-US")}`,
    ),
  );
  const filters = query.filters ?? {};
  const conversationIds = sortedUnique(filters.conversationIds);
  const conversationTypes = normalizeEnumValues(
    filters.conversationTypes,
    CONVERSATION_TYPES,
    "conversationTypes",
  );
  const senderIds = sortedUnique(filters.senderIds);
  const senderTypes = normalizeEnumValues(
    filters.senderTypes,
    SENDER_TYPES,
    "senderTypes",
  );
  const threadIds = sortedUnique(filters.threadIds);
  for (const [name, values] of Object.entries({
    conversationIds,
    conversationTypes,
    senderIds,
    senderTypes,
    threadIds,
  })) {
    assertFilterSize(name, values);
  }

  const fromInclusive = filters.fromInclusive ?? null;
  const toExclusive = filters.toExclusive ?? null;
  for (const [name, value] of Object.entries({ fromInclusive, toExclusive })) {
    if (value !== null && !Number.isSafeInteger(value)) {
      throw new Error(`${name} must be a safe integer timestamp`);
    }
  }
  if (
    fromInclusive !== null &&
    toExclusive !== null &&
    fromInclusive >= toExclusive
  ) {
    throw new Error("fromInclusive must be earlier than toExclusive");
  }

  return {
    clauses,
    combine: clauses.length === 1 ? "all" : query.combine,
    filters: {
      conversationIds,
      conversationTypes,
      fromInclusive,
      senderIds,
      senderTypes,
      threadIds,
      toExclusive,
    },
  };
}

export function queryDigest(query: NormalizedQuery): string {
  return createHash("sha256").update(JSON.stringify(query)).digest("hex");
}

function quoteFtsText(text: string): string {
  return `"${text.replaceAll('"', '""')}"`;
}

export function toFtsQuery(query: NormalizedQuery): string {
  const separator = query.combine === "all" ? " AND " : " OR ";
  return query.clauses
    .map((clause) => {
      const quoted = quoteFtsText(clause.text);
      return clause.match === "prefix" ? `${quoted}*` : quoted;
    })
    .join(separator);
}

function escapeRegularExpression(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export interface CompiledClause extends QueryClause {
  readonly pattern: RegExp;
}

export interface ClauseMatch {
  readonly clause: CompiledClause;
  readonly firstOffset: number;
  readonly occurrences: number;
}

export function compileQueryClauses(
  query: NormalizedQuery,
): readonly CompiledClause[] {
  return query.clauses.map((clause) => {
    const escaped = escapeRegularExpression(clause.text);
    let source: string;
    if (clause.match === "phrase") {
      const tokens = clause.text.match(/[\p{L}\p{N}]+/gu) ?? [];
      source = tokens.map(escapeRegularExpression).join("[^\\p{L}\\p{N}]+");
    } else if (clause.match === "prefix") {
      source = `${escaped}[\\p{L}\\p{N}]*`;
    } else {
      source = escaped;
    }

    return {
      ...clause,
      pattern: new RegExp(
        `(?<![\\p{L}\\p{N}])${source}(?![\\p{L}\\p{N}])`,
        "giu",
      ),
    };
  });
}

export function matchText(
  text: string,
  clauses: readonly CompiledClause[],
  combine: "all" | "any",
): readonly ClauseMatch[] | null {
  const matches = clauses.map((clause) => {
    // matchAll copies lastIndex. Eligibility must never inherit a prior cursor.
    clause.pattern.lastIndex = 0;
    let occurrences = 0;
    let firstOffset = 0;
    for (const match of text.matchAll(clause.pattern)) {
      if (occurrences === 0) firstOffset = match.index;
      occurrences += 1;
    }
    return { clause, firstOffset, occurrences };
  });
  const accepted =
    combine === "all"
      ? matches.every((match) => match.occurrences > 0)
      : matches.some((match) => match.occurrences > 0);
  return accepted ? matches.filter((match) => match.occurrences > 0) : null;
}
