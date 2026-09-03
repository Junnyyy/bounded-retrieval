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

    return finalizeResult({
      maximumBytes: RESULT_LIMITS.measureBytes,
      messageIds: () => [],
      nextActions:
        measured.outcome === "complete"
          ? ["Use discover_messages with the same structured query for evidence."]
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
                duration_ms: Math.round(measured.durationMilliseconds * 100) / 100,
                metrics: measured.metrics,
                normalized_query: serializeQuery(measured.query),
                provenance: measured.provenance,
                time_buckets: timeBuckets,
              }
            : {
                candidate_rows_examined: measured.candidateRowsExamined,
                duration_ms: Math.round(measured.durationMilliseconds * 100) / 100,
                normalized_query: serializeQuery(measured.query),
                reason: measured.reason,
              },
        ),
      resultKind: "measurement",
      shrink: () => {
        if (timeBuckets.length === 0) return false;
        timeBuckets.pop();
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

    return finalizeResult({
      maximumBytes: RESULT_LIMITS.responseBytes,
      messageIds: () => evidence.map((item) => item.messageId),
      nextActions: [
        "Use sample_messages with query_ref to inspect another distribution.",
        "Use expand_message_context with query_ref and a returned message_ref.",
        "Use export_messages with query_ref for exhaustive output.",
      ],
      omitted: () =>
        totalMessages === null ? null : Math.max(0, totalMessages - evidence.length),
      outcome:
        discovery.shape.outcome === "complete" ? "complete" : "incomplete",
      queryRef: reference.queryRef,
      registry: this.#registry,
      result: () =>
        asRecord({
          candidate_rows_examined: discovery.candidateRowsExamined,
          duration_ms: Math.round(discovery.durationMilliseconds * 100) / 100,
          evidence: evidence.map(serializeEvidence),
          normalized_query: serializeQuery(discovery.query),
          selection: {
            complete: discovery.selectionComplete,
            kind: "ranked_thread_diverse",
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
      shrink: () => {
        if (evidence.length <= 1) return false;
        evidence.pop();
        shrunk = true;
        return true;
      },
      truncated: () =>
        shrunk ||
        !discovery.selectionComplete ||
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

    return finalizeResult({
      maximumBytes: RESULT_LIMITS.responseBytes,
      messageIds: () => evidence.map((item) => item.messageId),
      nextActions: [
        "Use expand_message_context on a returned message_ref.",
        "Refine the structured query if this sample changes the investigation.",
        "Use export_messages for exhaustive output.",
      ],
      omitted: () => null,
      outcome: sampled.outcome,
      queryRef,
      registry: this.#registry,
      result: () =>
        asRecord({
          candidate_rows_examined: sampled.candidateRowsExamined,
          duration_ms: Math.round(sampled.durationMilliseconds * 100) / 100,
          evidence: evidence.map(serializeEvidence),
          selection: { kind: strategy, seed },
        }),
      resultKind: "sample",
      shrink: () => {
        if (evidence.length <= 1) return false;
        evidence.pop();
        shrunk = true;
        return true;
      },
      truncated: () => shrunk || sampled.outcome === "incomplete",
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

    return finalizeResult({
      maximumBytes: RESULT_LIMITS.expandContextBytes,
      messageIds: () => messages.map((message) => message.messageId),
      nextActions: [
        "Use another disclosed message_ref to inspect a different context.",
        "Use sample_messages to broaden the evidence distribution.",
      ],
      omitted: () =>
        context.messages.length - messages.length +
        Number(context.clippedBefore) +
        Number(context.clippedAfter),
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
        }),
      resultKind: "message_context",
      shrink: () => {
        if (messages.length <= 1) return false;
        const removableIndex = messages.findIndex(
          (message) => message.messageId !== messageId,
        );
        if (removableIndex === -1) return false;
        messages.splice(removableIndex, 1);
        shrunk = true;
        return true;
      },
      truncated: () =>
        shrunk || context.clippedBefore || context.clippedAfter,
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
