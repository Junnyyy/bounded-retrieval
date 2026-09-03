import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { DatabaseSync } from "node:sqlite";

import { readCorpusMetadata } from "../database/corpus.ts";
import { iterateCandidates } from "./candidates.ts";
import { evidenceCompiler, toEvidence, type EvidenceRecord } from "./evidence.ts";
import { DEFAULT_EXECUTION_LIMITS, type ExecutionLimits } from "./measure.ts";
import { normalizeQuery, type NormalizedQuery, type StructuredQuery } from "./query.ts";

export const SAMPLE_STRATEGIES = [
  "uniform",
  "across_time",
  "across_conversations",
] as const;
export type SampleStrategy = (typeof SAMPLE_STRATEGIES)[number];

interface ScoredEvidence {
  readonly evidence: EvidenceRecord;
  readonly score: string;
}

export interface SampleResult {
  readonly candidateRowsExamined: number;
  readonly durationMilliseconds: number;
  readonly evidence: readonly EvidenceRecord[];
  readonly outcome: "complete" | "incomplete";
  readonly query: NormalizedQuery;
  readonly strategy: SampleStrategy;
}

function score(seed: string, strategy: SampleStrategy, messageId: string): string {
  return createHash("sha256")
    .update(`${seed}\u0000${strategy}\u0000${messageId}`)
    .digest("hex");
}

function insertScored(
  bucket: ScoredEvidence[],
  candidate: ScoredEvidence,
  limit: number,
): void {
  bucket.push(candidate);
  bucket.sort((left, right) => left.score.localeCompare(right.score));
  if (bucket.length > limit) bucket.pop();
}

function stratum(strategy: SampleStrategy, evidence: EvidenceRecord): string {
  if (strategy === "across_time") return evidence.sentAt.slice(0, 10);
  if (strategy === "across_conversations") return evidence.conversation.id;
  return "all";
}

export function sampleMessages(
  database: DatabaseSync,
  structuredQuery: StructuredQuery,
  options: {
    readonly excludeMessageIds?: ReadonlySet<string>;
    readonly executionLimits?: ExecutionLimits;
    readonly limit?: number;
    readonly seed: string;
    readonly strategy: SampleStrategy;
  },
): SampleResult {
  if (!SAMPLE_STRATEGIES.includes(options.strategy)) {
    throw new Error(`Unsupported sampling strategy ${JSON.stringify(options.strategy)}`);
  }
  const query = normalizeQuery(structuredQuery);
  const metadata = readCorpusMetadata(database);
  const clauses = evidenceCompiler(query);
  const limit = Math.max(1, Math.min(options.limit ?? 8, 8));
  const executionLimits = options.executionLimits ?? DEFAULT_EXECUTION_LIMITS;
  const excluded = options.excludeMessageIds ?? new Set<string>();
  const buckets = new Map<string, ScoredEvidence[]>();
  const startedAt = performance.now();
  let candidateRowsExamined = 0;
  let outcome: "complete" | "incomplete" = "complete";

  for (const candidate of iterateCandidates(database, query)) {
    candidateRowsExamined += 1;
    if (
      candidateRowsExamined > executionLimits.maxCandidateRows ||
      performance.now() - startedAt > executionLimits.maxMilliseconds
    ) {
      outcome = "incomplete";
      break;
    }
    if (excluded.has(candidate.message.messageId)) continue;

    const evidence = toEvidence(candidate.message, {
      clauses,
      corpusVersion: metadata.version,
      maximumSnippetCharacters: 320,
      query,
      rank: null,
    });
    if (evidence === null) continue;
    const key = stratum(options.strategy, evidence);
    const bucket = buckets.get(key) ?? [];
    insertScored(
      bucket,
      {
        evidence,
        score: score(options.seed, options.strategy, evidence.messageId),
      },
      limit,
    );
    buckets.set(key, bucket);
  }

  const selected: EvidenceRecord[] = [];
  const selectedThreads = new Set<string>();
  const orderedBuckets = Array.from(buckets.entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  let position = 0;
  while (selected.length < limit) {
    let added = false;
    for (const [, bucket] of orderedBuckets) {
      const candidate = bucket[position];
      if (
        candidate !== undefined &&
        !selectedThreads.has(candidate.evidence.threadRef)
      ) {
        selected.push(candidate.evidence);
        selectedThreads.add(candidate.evidence.threadRef);
        added = true;
        if (selected.length === limit) break;
      }
    }
    if (!added && position >= limit) break;
    position += 1;
  }

  return {
    candidateRowsExamined,
    durationMilliseconds: performance.now() - startedAt,
    evidence: selected,
    outcome,
    query,
    strategy: options.strategy,
  };
}
