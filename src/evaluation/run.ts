import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { RESULT_LIMITS } from "../budget/limits.ts";
import type { CorpusGroundTruth } from "../corpus/generate.ts";
import { openCorpusDatabase, readCorpusMetadata } from "../database/corpus.ts";
import type { StructuredQuery } from "../retrieval/query.ts";
import { BoundedRetrievalService } from "../service/bounded-retrieval-service.ts";
import type { EncodedResult } from "../service/result-envelope.ts";
import { naiveRegexSearch } from "./naive-search.ts";
import { runDiscoveryExperiments } from "./discovery-experiments.ts";
import { scoreEvidence } from "./evidence-quality.ts";

const OPENAI_PATTERN = /(?<![\p{L}\p{N}])OpenAI(?![\p{L}\p{N}])/giu;

interface ToolCallRecord {
  readonly bytes: number;
  readonly name: string;
  readonly outcome: "complete" | "incomplete";
  readonly queryRef: string;
  readonly resultKind: string;
}

export interface EvaluationRecord {
  readonly assertions: {
    readonly exactCountMatchesGroundTruth: boolean;
    readonly everyBoundedResultWithinCap: boolean;
    readonly frequencyResultReductionAtLeast90Percent: boolean;
    readonly queryBudgetWithinCap: boolean;
    readonly refinedConcernCoverageComplete: boolean;
  };
  readonly corpus: {
    readonly messageCount: number;
    readonly profile: string;
    readonly realistic: boolean;
    readonly seed: string;
    readonly version: string;
  };
  readonly evaluation: {
    readonly mode: "deterministic";
    readonly note: string;
  };
  readonly discoveryExperiments: ReturnType<typeof runDiscoveryExperiments>;
  readonly generatedAt: string;
  readonly runtime: {
    readonly node: string;
  };
  readonly scenarios: {
    readonly clientConcerns: ScenarioRecord;
    readonly legacyClientConcerns: ScenarioRecord;
    readonly frequency: ScenarioRecord;
  };
  readonly schemaVersion: "2";
}

interface ScenarioRecord {
  readonly quality?: ReturnType<typeof scoreEvidence>;
  readonly bounded: {
    readonly calls: readonly ToolCallRecord[];
    readonly peakResultBytes: number;
    readonly totalResultBytes: number;
  };
  readonly naive: {
    readonly candidateRowsExamined: number;
    readonly matchingMessages: number;
    readonly occurrences: number;
    readonly resultBytes: number;
  };
  readonly question: string;
  readonly reductionPercent: number;
}

function asToolCall(
  name: string,
  result: EncodedResult<Record<string, unknown>>,
): ToolCallRecord {
  return {
    bytes: result.bytes,
    name,
    outcome: result.envelope.outcome,
    queryRef: result.envelope.query_ref,
    resultKind: result.envelope.result_kind,
  };
}

function evidenceReferences(
  result: EncodedResult<Record<string, unknown>>,
): readonly string[] {
  const payload = result.envelope.result as {
    readonly evidence?: readonly { readonly message_ref?: unknown }[];
  };
  return (payload.evidence ?? [])
    .map((evidence) => evidence.message_ref)
    .filter((reference): reference is string => typeof reference === "string");
}

function scenario(
  question: string,
  naive: ReturnType<typeof naiveRegexSearch>,
  calls: readonly ToolCallRecord[],
): ScenarioRecord {
  const totalResultBytes = calls.reduce((total, call) => total + call.bytes, 0);
  const reductionPercent =
    naive.mcpResultBytes === 0
      ? 0
      : ((naive.mcpResultBytes - totalResultBytes) / naive.mcpResultBytes) * 100;
  return {
    bounded: {
      calls,
      peakResultBytes: Math.max(...calls.map((call) => call.bytes)),
      totalResultBytes,
    },
    naive: {
      candidateRowsExamined: naive.candidateRowsExamined,
      matchingMessages: naive.matchingMessages,
      occurrences: naive.occurrences,
      resultBytes: naive.mcpResultBytes,
    },
    question,
    reductionPercent: Math.round(reductionPercent * 100) / 100,
  };
}

export function runDeterministicEvaluation(options: {
  readonly artifactDirectory: string;
  readonly databasePath: string;
  readonly groundTruth: CorpusGroundTruth;
  readonly outputPath: string;
}): EvaluationRecord {
  const database = openCorpusDatabase(options.databasePath, { readOnly: true });
  const metadata = readCorpusMetadata(database);
  if (options.groundTruth.corpusVersion !== metadata.version) {
    database.close();
    throw new Error("Ground truth does not match the evaluated corpus version");
  }
  let naive: ReturnType<typeof naiveRegexSearch>;
  try {
    naive = naiveRegexSearch(database, OPENAI_PATTERN);
  } finally {
    database.close();
  }

  const frequencyQuery: StructuredQuery = {
    clauses: [{ match: "literal", role: "canonical", text: "OpenAI" }],
    combine: "all",
  };
  const measured = (() => {
    const service = new BoundedRetrievalService(
      options.databasePath,
      options.artifactDirectory,
    );
    try {
      return service.measureMessages(frequencyQuery);
    } finally {
      service.close();
    }
  })();

  const concernQuery: StructuredQuery = {
    clauses: [{ match: "literal", role: "canonical", text: "OpenAI" }],
    combine: "all",
    filters: { senderTypes: ["client"] },
  };
  const { discovered, expanded, sampled } = (() => {
    const service = new BoundedRetrievalService(
      options.databasePath,
      options.artifactDirectory,
    );
    try {
      const discoveredResult = service.discoverMessages(concernQuery, 5);
      const queryRef = discoveredResult.envelope.query_ref;
      const sampledResult = service.sampleMessages(
        queryRef,
        "across_time",
        "evaluation-client-concerns-v1",
        3,
      );
      const anchor =
        evidenceReferences(discoveredResult)[0] ??
        evidenceReferences(sampledResult)[0];
      if (anchor === undefined) {
        throw new Error("Concern evaluation did not disclose an anchor message");
      }
      return {
        discovered: discoveredResult,
        expanded: service.expandMessageContext(queryRef, anchor, 8),
        sampled: sampledResult,
      };
    } finally {
      service.close();
    }
  })();

  const frequency = scenario(
    "How often did OpenAI come up?",
    naive,
    [asToolCall("measure_messages", measured)],
  );
  const legacyClientConcerns = scenario(
    "What concerns did clients raise about OpenAI?",
    naive,
    [
      asToolCall("discover_messages", discovered),
      asToolCall("sample_messages", sampled),
      asToolCall("expand_message_context", expanded),
    ],
  );
  const discoveryExperiments = runDiscoveryExperiments(options);
  const refined = discoveryExperiments.find((experiment) => experiment.name === "refined_lexical")!;
  const clientConcerns = {
    ...scenario("What concerns did clients raise about OpenAI? (hand-authored lexical refinements)", naive,
      refined.calls.map((call) => ({ bytes: call.bytes, name: call.tool, outcome: call.outcome, queryRef: call.queryRef, resultKind: "discovery" }))),
    quality: refined.quality,
  };
  const measuredPayload = measured.envelope.result as {
    readonly metrics?: { readonly messages?: unknown; readonly occurrences?: unknown; readonly threads?: unknown; readonly conversations?: unknown };
  };
  const calls = [...frequency.bounded.calls, ...legacyClientConcerns.bounded.calls,
    ...discoveryExperiments.flatMap((experiment) => experiment.calls.map((call) => ({
      bytes: call.bytes, name: call.tool, outcome: call.outcome, queryRef: call.queryRef, resultKind: "discovery_experiment",
    })))];
  const record: EvaluationRecord = {
    assertions: {
      exactCountMatchesGroundTruth:
        measuredPayload.metrics?.messages ===
          options.groundTruth.openAi.matchingMessageCount &&
        measuredPayload.metrics.occurrences ===
          options.groundTruth.openAi.occurrenceCount &&
        measuredPayload.metrics.threads === options.groundTruth.openAi.distinctThreads &&
        measuredPayload.metrics.conversations === options.groundTruth.openAi.distinctConversations,
      everyBoundedResultWithinCap: calls.every(
        (call) => call.bytes <= (call.name === "measure_messages" ? RESULT_LIMITS.measureBytes
          : call.name === "expand_message_context" ? RESULT_LIMITS.expandContextBytes : RESULT_LIMITS.responseBytes),
      ),
      frequencyResultReductionAtLeast90Percent:
        frequency.reductionPercent >= 90,
      queryBudgetWithinCap:
        legacyClientConcerns.bounded.totalResultBytes <= RESULT_LIMITS.cumulativeQueryBytes &&
        discoveryExperiments.every((experiment) => experiment.queryBudgetsWithinCap),
      refinedConcernCoverageComplete: refined.quality.allCategoriesSupported,
    },
    corpus: {
      messageCount: metadata.messageCount,
      profile: metadata.profile,
      realistic: metadata.realistic,
      seed: metadata.seed,
      version: metadata.version,
    },
    evaluation: {
      mode: "deterministic",
      note: "No model was called. This isolates retrieval correctness and full MCP-compatible result bytes; live FX runs are recorded separately.",
    },
    discoveryExperiments,
    generatedAt: new Date().toISOString(),
    runtime: { node: process.version },
    scenarios: { clientConcerns, legacyClientConcerns: { ...legacyClientConcerns, quality: scoreEvidence([discovered, sampled, expanded], options.groundTruth) }, frequency },
    schemaVersion: "2",
  };

  mkdirSync(dirname(resolve(options.outputPath)), { recursive: true });
  writeFileSync(
    resolve(options.outputPath),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
  return record;
}
