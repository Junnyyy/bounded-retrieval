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
      message_id: string;
      message_ref: string;
    }[];
    const sampled = service.sampleMessages(
      discovery.envelope.query_ref,
      "across_time",
      "service-sample",
    );
    const sampledEvidence = sampled.envelope.result.evidence as readonly {
      message_id: string;
      message_ref: string;
    }[];
    assert.equal(
      sampledEvidence.some((sample) =>
        discovered.some((item) => item.message_id === sample.message_id),
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
