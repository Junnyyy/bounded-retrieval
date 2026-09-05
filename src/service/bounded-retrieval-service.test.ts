import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  RESULT_LIMITS,
  ResultSizeExceededError,
  serializedBytes,
} from "../budget/limits.ts";
import { generateCorpus } from "../corpus/generate.ts";
import type { CorpusProfile } from "../corpus/profiles.ts";
import { BoundedRetrievalService } from "./bounded-retrieval-service.ts";
import { discoverOutputSchema, measureOutputSchema, sampleOutputSchema, expandContextOutputSchema, exportOutputSchema } from "../mcp/schemas.ts";
import { withTestCorpus } from "../testing/corpus.ts";

const PROFILE: CorpusProfile = {
  days: 7,
  description: "service test fixture",
  messageCount: 5_000,
  name: "week",
  participantCount: 20,
  realistic: true,
};

const QUERY = {
  clauses: [{ match: "literal", role: "canonical", text: "OpenAI" }],
  combine: "any",
} as const;

function withService(run: (service: BoundedRetrievalService) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "bounded-retrieval-service-"));
  const databasePath = join(directory, "fixture.sqlite");
  try {
    generateCorpus({ databasePath, profile: PROFILE, seed: "service-seed" });
    const service = new BoundedRetrievalService(
      databasePath,
      join(directory, "exports"),
    );
    try {
      run(service);
    } finally {
      service.close();
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
}

test("keeps measurement and discovery inside their serialized MCP caps", () => {
  withService((service) => {
    const measurement = service.measureMessages(QUERY);
    assert.ok(measurement.bytes <= RESULT_LIMITS.measureBytes);
    assert.equal(serializedBytes(measurement.mcpResult), measurement.bytes);
    assert.equal(measurement.envelope.result_kind, "measurement");
    assert.equal("evidence" in measurement.envelope.result, false);

    const discovery = service.discoverMessages(QUERY);
    assert.ok(discovery.bytes <= RESULT_LIMITS.responseBytes);
    assert.equal(discovery.envelope.query_ref, measurement.envelope.query_ref);
    assert.ok(discovery.envelope.disclosure.cumulative_bytes > discovery.bytes);
  });
});

test("samples undisclosed evidence and expands only a disclosed anchor", () => {
  withService((service) => {
    const discovery = service.discoverMessages(QUERY);
    const discovered = discovery.envelope.result.evidence as readonly {
      message_ref: string;
    }[];
    const sampled = service.sampleMessages(
      discovery.envelope.query_ref,
      "across_time",
      "service-sample",
    );
    const sampledEvidence = sampled.envelope.result.evidence as readonly {
      message_ref: string;
    }[];
    assert.equal(
      sampledEvidence.some((sample) =>
        discovered.some((item) => item.message_ref === sample.message_ref),
      ),
      false,
    );

    const context = service.expandMessageContext(
      discovery.envelope.query_ref,
      discovered[0]!.message_ref,
    );
    assert.ok(context.bytes <= RESULT_LIMITS.expandContextBytes);
    assert.equal(context.envelope.result_kind, "message_context");
    assert.throws(
      () =>
        service.expandMessageContext(
          discovery.envelope.query_ref,
          `corpus://${service.corpusVersion}/messages/message-999999999`,
        ),
      /only be expanded from evidence disclosed/u,
    );
  });
});

test("returns export metadata without embedding exported rows", () => {
  withService((service) => {
    const measurement = service.measureMessages(QUERY);
    const exported = service.exportMessages(measurement.envelope.query_ref);
    assert.equal(exported.envelope.outcome, "complete");
    assert.equal("text" in exported.envelope.result, false);
    assert.equal("artifact_path" in exported.envelope.result, true);
    assert.ok(exported.bytes <= RESULT_LIMITS.responseBytes);
  });
});

test("equivalent repeated calls cannot reset cumulative disclosure", () => {
  withService((service) => {
    let queryRef = "";
    assert.throws(() => {
      for (;;) {
        const result = service.measureMessages({
          clauses: [
            { match: "literal", role: "canonical", text: " openai " },
          ],
          combine: "any",
        });
        queryRef = result.envelope.query_ref;
      }
    }, ResultSizeExceededError);
    assert.notEqual(queryRef, "");
    const state = service.queryState(queryRef);
    assert.ok(state.disclosure.bytes <= RESULT_LIMITS.cumulativeQueryBytes);
    assert.ok(state.disclosure.remainingBytes < RESULT_LIMITS.measureBytes);
  });
});

test("versioned outputs validate against their tool-specific contracts", () => {
  withService((service) => {
    const measurement = service.measureMessages(QUERY);
    assert.ok(measureOutputSchema.safeParse(measurement.envelope).success);
    assert.equal(measurement.envelope.schema_version, "2");
    const discovery = service.discoverMessages(QUERY, 2);
    assert.ok(discoverOutputSchema.safeParse(discovery.envelope).success);
    assert.equal(discovery.envelope.result.selection !== undefined, true);
    const first = (discovery.envelope.result.evidence as { message_ref: string }[])[0]!;
    assert.equal("message_id" in first, false);
    assert.equal("rank" in first, false);
    const sampled = service.sampleMessages(discovery.envelope.query_ref, "uniform", "contract", 2);
    assert.ok(sampleOutputSchema.safeParse(sampled.envelope).success);
    const context = service.expandMessageContext(discovery.envelope.query_ref, first.message_ref, 1);
    assert.ok(expandContextOutputSchema.safeParse(context.envelope).success);
    const exported = service.exportMessages(discovery.envelope.query_ref);
    assert.ok(exportOutputSchema.safeParse(exported.envelope).success);
    assert.equal(discoverOutputSchema.safeParse(sampled.envelope).success, false);
    for (const result of [measurement, discovery, sampled, context, exported]) {
      assert.equal(serializedBytes(result.mcpResult), result.envelope.disclosure.response_bytes);
    }
  });
});

test("zero-match discovery is exact, empty, and offers no absent anchor", () => {
  withService((service) => {
    const result = service.discoverMessages({
      clauses: [{ match: "literal", role: "canonical", text: "absentterm" }], combine: "all",
    });
    assert.equal(result.envelope.outcome, "complete");
    assert.equal(result.envelope.truncated, false);
    assert.equal(result.envelope.omitted, 0);
    assert.deepEqual(result.envelope.next_actions, []);
    assert.deepEqual(result.envelope.result.evidence, []);
    assert.deepEqual(result.envelope.result.selection, { kind: "ranked_exact_text_and_thread_diverse", exhaustive: true, stop_reasons: [] });
  });
});

test("aggregate repeat counts do not authorize undisclosed group members", () => {
  withTestCorpus([{ text: "OpenAI concern" }, { text: "OpenAI concern" }], (_database, path) => {
    const service = new BoundedRetrievalService(path, join(path, "..", "exports"));
    try {
      const result = service.discoverMessages(QUERY);
      const evidence = result.envelope.result.evidence as { message_ref: string; same_text_matches: { messages: number } }[];
      assert.equal(evidence.length, 1);
      assert.equal(evidence[0]?.same_text_matches.messages, 2);
      assert.throws(() => service.expandMessageContext(result.envelope.query_ref,
        `corpus://${service.corpusVersion}/messages/message-1`), /only be expanded from evidence disclosed/u);
    } finally { service.close(); }
  });
});

test("byte fitting reports the final transmitted selection and protects omitted anchors", () => {
  withTestCorpus(Array.from({ length: 8 }, (_, index) => ({
    text: `OpenAI synthetic statement number ${index}`,
    senderOrganization: "😀".repeat(500),
  })), (_database, path) => {
    const service = new BoundedRetrievalService(path, join(path, "..", "exports"));
    try {
      const result = service.discoverMessages(QUERY);
      const evidence = result.envelope.result.evidence as { message_ref: string }[];
      const selection = result.envelope.result.selection as { exhaustive: boolean; stop_reasons: string[] };
      assert.ok(evidence.length > 0 && evidence.length < 8);
      assert.equal(result.envelope.omitted, 8 - evidence.length);
      assert.equal(selection.exhaustive, false);
      assert.ok(selection.stop_reasons.includes("response_byte_limit"));
      assert.equal(result.bytes, serializedBytes(result.mcpResult));
      assert.ok(result.bytes <= RESULT_LIMITS.responseBytes);
      assert.equal(service.queryState(result.envelope.query_ref).disclosure.messageCount, evidence.length);
    } finally { service.close(); }
  });
});

test("context fitting preserves the root and anchor and reports removed neighbors", () => {
  withTestCorpus([
    { messageId: "root", text: "Synthetic discussion root" },
    ...Array.from({ length: 12 }, (_, index) => ({
      messageId: `reply-${index}`, text: index === 6 ? "OpenAI anchor" : "😀".repeat(450),
      threadRootMessageId: "root", replyToMessageId: "root",
    })),
  ], (_database, path) => {
    const service = new BoundedRetrievalService(path, join(path, "..", "exports"));
    try {
      const discovery = service.discoverMessages(QUERY);
      const reference = (discovery.envelope.result.evidence as { message_ref: string }[])[0]!.message_ref;
      const result = service.expandMessageContext(discovery.envelope.query_ref, reference, 20);
      const payload = result.envelope.result as { messages: { message_id: string }[]; clipped_before: boolean; clipped_after: boolean };
      assert.ok(payload.messages.some((message) => message.message_id === "root"));
      assert.ok(payload.messages.some((message) => message.message_id === "reply-6"));
      assert.equal(result.envelope.omitted, 13 - payload.messages.length);
      assert.ok(payload.clipped_before || payload.clipped_after);
      assert.ok(result.bytes <= RESULT_LIMITS.expandContextBytes);
    } finally { service.close(); }
  });
});
