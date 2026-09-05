import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { RESULT_LIMITS } from "../budget/limits.ts";
import { openCorpusDatabase, readCorpusMetadata } from "../database/corpus.ts";
import { exportMessages } from "../export/export-messages.ts";
import { expandMessageContext } from "../retrieval/context.ts";
import { discoverMessages } from "../retrieval/discover.ts";
import { measureMessages } from "../retrieval/measure.ts";
import { parseMessageReference } from "../retrieval/references.ts";
import { sampleMessages, type SampleStrategy } from "../retrieval/sample.ts";
import type { StructuredQuery } from "../retrieval/query.ts";
import { QueryReferenceError, QueryRegistry } from "../session/query-registry.ts";
import {
  finalizeResult,
  type EncodedResult,
} from "./result-envelope.ts";
import {
  serializeContextMessage,
  serializeEvidence,
  serializeExport,
  serializeQuery,
} from "./serialization.ts";

type AnyEncodedResult = EncodedResult<Record<string, unknown>>;

function asRecord<Value extends object>(value: Value): Value & Record<string, unknown> {
  return value as Value & Record<string, unknown>;
}

export class BoundedRetrievalService {
  readonly #artifactDirectory: string;
  readonly #database: DatabaseSync;
  readonly #registry: QueryRegistry;
  readonly corpusVersion: string;

  constructor(databasePath: string, artifactDirectory: string) {
    this.#database = openCorpusDatabase(resolve(databasePath), { readOnly: true });
    const metadata = readCorpusMetadata(this.#database);
    this.corpusVersion = metadata.version;
    this.#artifactDirectory = resolve(artifactDirectory);
    this.#registry = new QueryRegistry(metadata.version);
  }

  close(): void {
    this.#database.close();
  }

  measureMessages(query: StructuredQuery): AnyEncodedResult {
    const reference = this.#registry.register(query);
    const measured = measureMessages(this.#database, reference.query);
    const timeBuckets =
      measured.outcome === "complete" ? [...measured.timeBuckets] : [];
    let shrunk = false;
    const stopReasons = new Set<string>(measured.outcome === "incomplete" ? [measured.reason] : []);

    return finalizeResult({
      maximumBytes: RESULT_LIMITS.measureBytes,
      messageIds: () => [],
      nextActions:
        measured.outcome === "complete"
          ? []
          : ["Narrow the query or time range before measuring again."],
      omitted: () =>
        measured.outcome === "complete"
          ? measured.timeBuckets.length - timeBuckets.length
          : null,
      outcome: measured.outcome,
      queryRef: reference.queryRef,
      registry: this.#registry,
      result: () =>
        asRecord(
          measured.outcome === "complete"
            ? {
                candidate_rows_examined: measured.candidateRowsExamined,
                metrics: measured.metrics,
                normalized_query: serializeQuery(measured.query),
                provenance: measured.provenance,
                time_buckets: timeBuckets,
                stop_reasons: [...stopReasons],
              }
            : {
                candidate_rows_examined: measured.candidateRowsExamined,
                normalized_query: serializeQuery(measured.query),
                reason: measured.reason,
                stop_reasons: [...stopReasons],
              },
        ),
      resultKind: "measurement",
      shrink: (reasons) => {
        if (timeBuckets.length === 0) return false;
        timeBuckets.pop();
        for (const reason of reasons) stopReasons.add(reason);
        shrunk = true;
        return true;
      },
      truncated: () => shrunk || measured.outcome === "incomplete",
    });
  }

  discoverMessages(query: StructuredQuery, requestedLimit = 8): AnyEncodedResult {
    const reference = this.#registry.register(query);
    const discovery = discoverMessages(this.#database, reference.query, {
      limit: requestedLimit,
    });
    const evidence = [...discovery.evidence];
    const totalMessages =
      discovery.shape.outcome === "complete"
        ? discovery.shape.metrics.messages
        : null;
    let shrunk = false;
    const stopReasons = new Set<string>();
    if (discovery.stopReason !== null && !(discovery.stopReason === "item_limit" && totalMessages === evidence.length)) {
      stopReasons.add(discovery.stopReason);
    }
    if (discovery.shape.outcome === "incomplete") stopReasons.add(discovery.shape.reason);
    const incomplete = discovery.shape.outcome === "incomplete" ||
      discovery.stopReason === "candidate_limit" || discovery.stopReason === "time_limit";

    return finalizeResult({
      maximumBytes: RESULT_LIMITS.responseBytes,
      messageIds: () => evidence.map((item) => item.messageId),
      nextActions: () => incomplete
        ? ["Narrow the query or time range; the scan did not complete."]
        : evidence.some((item) => item.snippetClipped)
          ? ["A snippet is clipped; expand its message_ref if the missing text matters."]
          : [],
      omitted: () =>
        totalMessages === null ? null : Math.max(0, totalMessages - evidence.length),
      outcome: incomplete ? "incomplete" : "complete",
      queryRef: reference.queryRef,
      registry: this.#registry,
      result: () =>
        asRecord({
          candidate_rows_examined: discovery.candidateRowsExamined,
          evidence: evidence.map(serializeEvidence),
          normalized_query: serializeQuery(discovery.query),
          selection: {
            exhaustive: !incomplete && totalMessages === evidence.length,
            kind: "ranked_exact_text_and_thread_diverse",
            stop_reasons: [...stopReasons, ...(evidence.some((item) => item.snippetClipped) ? ["text_clipped"] : [])],
          },
          shape:
            discovery.shape.outcome === "complete"
              ? {
                  metrics: discovery.shape.metrics,
                  time_buckets: discovery.shape.timeBuckets,
                }
              : { reason: discovery.shape.reason },
        }),
      resultKind: "discovery",
      shrink: (reasons) => {
        if (evidence.length <= 1) return false;
        evidence.pop();
        for (const reason of reasons) stopReasons.add(reason);
        shrunk = true;
        return true;
      },
      truncated: () =>
        shrunk ||
        incomplete ||
        evidence.some((item) => item.snippetClipped) ||
        (totalMessages !== null && totalMessages > evidence.length),
    });
  }

  sampleMessages(
    queryRef: string,
    strategy: SampleStrategy,
    seed: string,
    requestedLimit = 8,
  ): AnyEncodedResult {
    const reference = this.#registry.get(queryRef);
    const sampled = sampleMessages(this.#database, reference.query, {
      excludeMessageIds: this.#registry.disclosedMessageIds(queryRef),
      limit: requestedLimit,
      seed,
      strategy,
    });
    const evidence = [...sampled.evidence];
    let shrunk = false;
    const stopReasons = new Set<string>(sampled.reason === null ? [] : [sampled.reason]);
    if (sampled.populationMessages > evidence.length) stopReasons.add("item_limit");

    return finalizeResult({
      maximumBytes: RESULT_LIMITS.responseBytes,
      messageIds: () => evidence.map((item) => item.messageId),
      nextActions: () => sampled.outcome === "incomplete"
        ? ["Narrow the query; this sample was selected from an incomplete scan."]
        : evidence.some((item) => item.snippetClipped)
          ? ["A snippet is clipped; expand its message_ref if the missing text matters."]
          : [],
      omitted: () => sampled.outcome === "complete" ? sampled.populationMessages - evidence.length : null,
      outcome: sampled.outcome,
      queryRef,
      registry: this.#registry,
      result: () =>
        asRecord({
          candidate_rows_examined: sampled.candidateRowsExamined,
          evidence: evidence.map(serializeEvidence),
          population: {
            unit: "message",
            excludes_disclosed: true,
            messages: sampled.outcome === "complete" ? sampled.populationMessages : null,
            strata: sampled.outcome === "complete" ? sampled.populationStrata : null,
          },
          selection: {
            kind: strategy,
            seed,
            exhaustive: sampled.outcome === "complete" && sampled.populationMessages === evidence.length,
            returned_strata: new Set(evidence.map((item) => strategy === "across_time"
              ? item.sentAt.slice(0, 10) : strategy === "across_conversations" ? item.conversation.id : "all")).size,
            stop_reasons: [...stopReasons, ...(evidence.some((item) => item.snippetClipped) ? ["text_clipped"] : [])],
          },
        }),
      resultKind: "sample",
      shrink: (reasons) => {
        if (evidence.length <= 1) return false;
        evidence.pop();
        for (const reason of reasons) stopReasons.add(reason);
        shrunk = true;
        return true;
      },
      truncated: () => shrunk || sampled.outcome === "incomplete" || sampled.populationMessages > evidence.length || evidence.some((item) => item.snippetClipped),
    });
  }

  expandMessageContext(
    queryRef: string,
    messageRef: string,
    requestedLimit = 20,
  ): AnyEncodedResult {
    const reference = this.#registry.get(queryRef);
    const messageId = parseMessageReference(messageRef, reference.corpusVersion);
    if (!this.#registry.hasDisclosedMessage(queryRef, messageId)) {
      throw new QueryReferenceError(
        "Message context may only be expanded from evidence disclosed by this query",
      );
    }
    const context = expandMessageContext(this.#database, messageId, requestedLimit);
    const messages = [...context.messages];
    let shrunk = false;
    const stopReasons = new Set<string>();
    if (context.clippedBefore || context.clippedAfter) stopReasons.add("context_window");

    return finalizeResult({
      maximumBytes: RESULT_LIMITS.expandContextBytes,
      messageIds: () => messages.map((message) => message.messageId),
      nextActions: [],
      omitted: () => context.totalMessages - messages.length,
      outcome: "complete",
      queryRef,
      registry: this.#registry,
      result: () =>
        asRecord({
          anchor_message_id: context.anchorMessageId,
          clipped_after: context.clippedAfter,
          clipped_before: context.clippedBefore,
          context_kind: context.contextKind,
          messages: messages.map(serializeContextMessage),
          stop_reasons: [...stopReasons, ...(messages.some((message) => message.textClipped) ? ["text_clipped"] : [])],
        }),
      resultKind: "message_context",
      shrink: (reasons) => {
        if (messages.length <= 1) return false;
        const removableIndex = messages.findIndex(
          (message) => message.messageId !== messageId,
        );
        if (removableIndex === -1) return false;
        messages.splice(removableIndex, 1);
        for (const reason of reasons) stopReasons.add(reason);
        shrunk = true;
        return true;
      },
      truncated: () =>
        shrunk || context.clippedBefore || context.clippedAfter || messages.some((message) => message.textClipped),
    });
  }

  exportMessages(queryRef: string): AnyEncodedResult {
    const reference = this.#registry.get(queryRef);
    const exported = exportMessages(
      this.#database,
      reference.query,
      this.#artifactDirectory,
    );

    return finalizeResult({
      maximumBytes: RESULT_LIMITS.responseBytes,
      messageIds: () => [],
      nextActions:
        exported.outcome === "complete"
          ? ["Inspect the local JSONL artifact outside model context."]
          : ["Narrow the query before requesting another export."],
      omitted: () => null,
      outcome: exported.outcome,
      queryRef,
      registry: this.#registry,
      result: () => asRecord(serializeExport(exported)),
      resultKind: "export",
      shrink: () => false,
      truncated: () => exported.outcome === "incomplete",
    });
  }

  queryState(queryRef: string) {
    return this.#registry.get(queryRef);
  }
}
