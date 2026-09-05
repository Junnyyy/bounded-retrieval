import { performance } from "node:perf_hooks";

import type { CorpusGroundTruth } from "../corpus/generate.ts";
import type { StructuredQuery } from "../retrieval/query.ts";
import { BoundedRetrievalService } from "../service/bounded-retrieval-service.ts";
import type { EncodedResult } from "../service/result-envelope.ts";
import { scoreEvidence } from "./evidence-quality.ts";

type Result = EncodedResult<Record<string, unknown>>;

export function runDiscoveryExperiments(options: {
  readonly artifactDirectory: string;
  readonly databasePath: string;
  readonly groundTruth: CorpusGroundTruth;
}) {
  const query: StructuredQuery = {
    clauses: [{ match: "literal", role: "canonical", text: "OpenAI" }],
    combine: "all",
    filters: { senderTypes: ["client"] },
  };
  const definitions = ["ranked", "ranked_then_sample", "refined_lexical"] as const;
  return definitions.map((name) => {
    const service = new BoundedRetrievalService(options.databasePath, options.artifactDirectory);
    const results: Result[] = [];
    const calls: {
      readonly tool: string;
      readonly bytes: number;
      readonly cumulativeInvestigationBytes: number;
      readonly durationMilliseconds: number;
      readonly candidateRowsExamined: number;
      readonly queryRef: string;
      readonly outcome: string;
      readonly quality: ReturnType<typeof scoreEvidence>;
    }[] = [];
    function record(tool: string, operation: () => Result): Result {
      const start = performance.now();
      const result = operation();
      const durationMilliseconds = performance.now() - start;
      results.push(result);
      calls.push({
        tool,
        bytes: result.bytes,
        cumulativeInvestigationBytes: results.reduce((total, item) => total + item.bytes, 0),
        durationMilliseconds: Math.round(durationMilliseconds * 100) / 100,
        candidateRowsExamined: Number(result.envelope.result.candidate_rows_examined ?? 0),
        queryRef: result.envelope.query_ref,
        outcome: result.envelope.outcome,
        quality: scoreEvidence(results, options.groundTruth),
      });
      return result;
    }
    try {
      if (name === "ranked") {
        record("discover_messages", () => service.discoverMessages(query, 8));
      } else if (name === "ranked_then_sample") {
        const discovery = record("discover_messages", () => service.discoverMessages(query, 5));
        const queryRef = discovery.envelope.query_ref;
        record("sample_messages", () => service.sampleMessages(queryRef, "across_time", "discovery-comparison-v1", 8));
        record("sample_messages", () => service.sampleMessages(queryRef, "across_conversations", "discovery-comparison-v1", 8));
      } else {
        // An explicit, hand-authored lexical strategy, not an agent-quality claim.
        // Terms are fixed before execution and never derived from truth labels.
        for (const term of ["concern", "needs", "difficult"]) {
          record("discover_messages", () => service.discoverMessages({
            ...query,
            clauses: [...query.clauses, { match: term === "concern" ? "prefix" : "literal", role: "canonical", text: term }],
          }, 8));
        }
      }
      return {
        name,
        strategy: name === "refined_lexical"
          ? "Three hand-authored queries: OpenAI AND concern-prefix, OpenAI AND needs, OpenAI AND difficult, all client-filtered. Vocabulary is fixture-informed; this is not a live agent or held-out language result."
          : name === "ranked"
            ? "One client-filtered OpenAI discovery, up to eight items."
            : "Client-filtered OpenAI discovery (five), then separate across-time and across-conversation samples (eight each).",
        calls,
        totalBytes: results.reduce((total, item) => total + item.bytes, 0),
        quality: scoreEvidence(results, options.groundTruth),
        queryBudgetsWithinCap: results.every((result) => result.envelope.disclosure.cumulative_bytes <= 48 * 1_024),
      };
    } finally {
      service.close();
    }
  });
}
