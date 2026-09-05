import { performance } from "node:perf_hooks";
import type { DatabaseSync } from "node:sqlite";

import { readCorpusMetadata } from "../database/corpus.ts";
import { iterateCandidates } from "./candidates.ts";
import { evidenceCompiler, toEvidence, type EvidenceRecord } from "./evidence.ts";
import {
  DEFAULT_EXECUTION_LIMITS,
  measureMessages,
  type ExecutionLimits,
  type MeasureResult,
} from "./measure.ts";
import { normalizeQuery, type NormalizedQuery, type StructuredQuery } from "./query.ts";

export const MAX_DISCOVERY_ITEMS = 8;
export const MAX_SNIPPET_CHARACTERS = 320;

export interface DiscoveryResult {
  readonly candidateRowsExamined: number;
  readonly durationMilliseconds: number;
  readonly evidence: readonly EvidenceRecord[];
  readonly query: NormalizedQuery;
  readonly selectionComplete: boolean;
  readonly stopReason: "item_limit" | "candidate_limit" | "time_limit" | null;
  readonly shape: MeasureResult;
}

export function discoverMessages(
  database: DatabaseSync,
  structuredQuery: StructuredQuery,
  options: {
    readonly excludeMessageIds?: ReadonlySet<string>;
    readonly executionLimits?: ExecutionLimits;
    readonly limit?: number;
    readonly maximumSnippetCharacters?: number;
  } = {},
): DiscoveryResult {
  const query = normalizeQuery(structuredQuery);
  const metadata = readCorpusMetadata(database);
  const clauses = evidenceCompiler(query);
  const limit = Math.max(1, Math.min(options.limit ?? MAX_DISCOVERY_ITEMS, MAX_DISCOVERY_ITEMS));
  const maximumSnippetCharacters = Math.max(
    80,
    Math.min(
      options.maximumSnippetCharacters ?? MAX_SNIPPET_CHARACTERS,
      MAX_SNIPPET_CHARACTERS,
    ),
  );
  const executionLimits = options.executionLimits ?? DEFAULT_EXECUTION_LIMITS;
  const excluded = options.excludeMessageIds ?? new Set<string>();
  const selectedThreads = new Set<string>();
  const evidence: EvidenceRecord[] = [];
  const startedAt = performance.now();
  let candidateRowsExamined = 0;
  let selectionComplete = true;
  let stopReason: DiscoveryResult["stopReason"] = null;

  for (const candidate of iterateCandidates(database, query, { ranked: true })) {
    candidateRowsExamined += 1;
    if (
      candidateRowsExamined > executionLimits.maxCandidateRows ||
      performance.now() - startedAt > executionLimits.maxMilliseconds
    ) {
      selectionComplete = false;
      stopReason = candidateRowsExamined > executionLimits.maxCandidateRows ? "candidate_limit" : "time_limit";
      break;
    }
    if (excluded.has(candidate.message.messageId)) {
      continue;
    }
    const candidateEvidence = toEvidence(candidate.message, {
      clauses,
      corpusVersion: metadata.version,
      maximumSnippetCharacters,
      query,
      rank: candidate.rank,
    });
    if (
      candidateEvidence === null ||
      selectedThreads.has(candidateEvidence.threadRef)
    ) {
      continue;
    }
    selectedThreads.add(candidateEvidence.threadRef);
    evidence.push(candidateEvidence);
    if (evidence.length === limit) {
      selectionComplete = false;
      stopReason = "item_limit";
      break;
    }
  }

  const shape = measureMessages(database, query, {
    maxCandidateRows: Math.max(0, executionLimits.maxCandidateRows - candidateRowsExamined),
    maxMilliseconds: Math.max(0, executionLimits.maxMilliseconds - (performance.now() - startedAt)),
  });
  return {
    candidateRowsExamined: candidateRowsExamined + shape.candidateRowsExamined,
    durationMilliseconds: performance.now() - startedAt,
    evidence,
    query,
    selectionComplete: selectionComplete && shape.outcome === "complete",
    stopReason,
    shape,
  };
}
