import { performance } from "node:perf_hooks";
import type { DatabaseSync } from "node:sqlite";

import { threadIdentity, type MessageRecord } from "../domain/message.ts";
import { iterateCandidates } from "./candidates.ts";
import {
  compileQueryClauses,
  matchText,
  normalizeQuery,
  type ClauseRole,
  type NormalizedQuery,
  type StructuredQuery,
} from "./query.ts";

export interface ExecutionLimits {
  readonly maxCandidateRows: number;
  readonly maxMilliseconds: number;
}

export const DEFAULT_EXECUTION_LIMITS: ExecutionLimits = {
  maxCandidateRows: 2_000_000,
  maxMilliseconds: 5_000,
};

export interface MentionMetrics {
  readonly conversations: number;
  readonly messages: number;
  readonly occurrences: number;
  readonly threads: number;
}

export interface MeasureCompleteResult {
  readonly candidateRowsExamined: number;
  readonly durationMilliseconds: number;
  readonly metrics: MentionMetrics;
  readonly outcome: "complete";
  readonly provenance: Readonly<Record<ClauseRole, MentionMetrics>>;
  readonly query: NormalizedQuery;
  readonly timeBuckets: readonly {
    readonly day: string;
    readonly messages: number;
  }[];
}

export interface MeasureIncompleteResult {
  readonly candidateRowsExamined: number;
  readonly durationMilliseconds: number;
  readonly outcome: "incomplete";
  readonly query: NormalizedQuery;
  readonly reason: "candidate_limit" | "time_limit";
}

export type MeasureResult = MeasureCompleteResult | MeasureIncompleteResult;

interface MutableMetrics {
  conversations: Set<string>;
  messages: Set<string>;
  occurrences: number;
  threads: Set<string>;
}

function mutableMetrics(): MutableMetrics {
  return {
    conversations: new Set(),
    messages: new Set(),
    occurrences: 0,
    threads: new Set(),
  };
}

function freezeMetrics(metrics: MutableMetrics): MentionMetrics {
  return {
    conversations: metrics.conversations.size,
    messages: metrics.messages.size,
    occurrences: metrics.occurrences,
    threads: metrics.threads.size,
  };
}

export function measureMessages(
  database: DatabaseSync,
  structuredQuery: StructuredQuery,
  limits: ExecutionLimits = DEFAULT_EXECUTION_LIMITS,
  onMatch?: (message: MessageRecord) => void,
): MeasureResult {
  const query = normalizeQuery(structuredQuery);
  const clauses = compileQueryClauses(query);
  const startedAt = performance.now();
  const overall = mutableMetrics();
  const provenance: Record<ClauseRole, MutableMetrics> = {
    alias: mutableMetrics(),
    canonical: mutableMetrics(),
  };
  const timeBuckets = new Map<string, number>();
  let candidateRowsExamined = 0;

  for (const candidate of iterateCandidates(database, query)) {
    candidateRowsExamined += 1;
    const durationMilliseconds = performance.now() - startedAt;
    if (candidateRowsExamined > limits.maxCandidateRows) {
      return {
        candidateRowsExamined,
        durationMilliseconds,
        outcome: "incomplete",
        query,
        reason: "candidate_limit",
      };
    }
    if (durationMilliseconds > limits.maxMilliseconds) {
      return {
        candidateRowsExamined,
        durationMilliseconds,
        outcome: "incomplete",
        query,
        reason: "time_limit",
      };
    }

    const matches = matchText(candidate.message.text, clauses, query.combine);
    if (matches === null) {
      continue;
    }
    onMatch?.(candidate.message);

    const threadId = threadIdentity(candidate.message);
    overall.messages.add(candidate.message.messageId);
    overall.threads.add(threadId);
    overall.conversations.add(candidate.message.conversationId);
    const day = new Date(candidate.message.sentAt).toISOString().slice(0, 10);
    timeBuckets.set(day, (timeBuckets.get(day) ?? 0) + 1);

    for (const match of matches) {
      overall.occurrences += match.occurrences;
      const roleMetrics = provenance[match.clause.role];
      roleMetrics.occurrences += match.occurrences;
      roleMetrics.messages.add(candidate.message.messageId);
      roleMetrics.threads.add(threadId);
      roleMetrics.conversations.add(candidate.message.conversationId);
    }
  }

  return {
    candidateRowsExamined,
    durationMilliseconds: performance.now() - startedAt,
    metrics: freezeMetrics(overall),
    outcome: "complete",
    provenance: {
      alias: freezeMetrics(provenance.alias),
      canonical: freezeMetrics(provenance.canonical),
    },
    query,
    timeBuckets: Array.from(timeBuckets, ([day, messages]) => ({ day, messages })),
  };
}
