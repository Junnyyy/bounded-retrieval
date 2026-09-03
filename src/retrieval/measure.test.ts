import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateCorpus, type GenerateCorpusResult } from "../corpus/generate.ts";
import type { CorpusProfile } from "../corpus/profiles.ts";
import { openCorpusDatabase } from "../database/corpus.ts";
import { measureMessages } from "./measure.ts";
import { normalizeQuery, queryDigest } from "./query.ts";

const PROFILE: CorpusProfile = {
  days: 7,
  description: "retrieval test fixture",
  messageCount: 5_000,
  name: "week",
  participantCount: 20,
  realistic: true,
};

function withCorpus(
  run: (path: string, generated: GenerateCorpusResult) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), "bounded-retrieval-measure-"));
  const path = join(directory, "fixture.sqlite");
  try {
    const generated = generateCorpus({
      databasePath: path,
      profile: PROFILE,
      seed: "measure-seed",
    });
    run(path, generated);
  } finally {
    rmSync(directory, { recursive: true });
  }
}

const OPENAI_QUERY = {
  clauses: [{ match: "literal", role: "canonical", text: "OpenAI" }],
  combine: "any",
} as const;

test("measures exact OpenAI metrics against generator ground truth", () => {
  withCorpus((path, generated) => {
    const database = openCorpusDatabase(path, { readOnly: true });
    try {
      const result = measureMessages(database, OPENAI_QUERY);
      assert.equal(result.outcome, "complete");
      if (result.outcome !== "complete") return;

      assert.deepEqual(result.metrics, {
        conversations: generated.groundTruth.openAi.distinctConversations,
        messages: generated.groundTruth.openAi.matchingMessageCount,
        occurrences: generated.groundTruth.openAi.occurrenceCount,
        threads: generated.groundTruth.openAi.distinctThreads,
      });
      assert.deepEqual(result.provenance.canonical, result.metrics);
      assert.deepEqual(result.provenance.alias, {
        conversations: 0,
        messages: 0,
        occurrences: 0,
        threads: 0,
      });
      assert.ok(result.timeBuckets.length > 0);
    } finally {
      database.close();
    }
  });
});

test("keeps literal and alias-expanded measurements separate", () => {
  withCorpus((path) => {
    const database = openCorpusDatabase(path, { readOnly: true });
    try {
      const result = measureMessages(database, {
        clauses: [
          { match: "literal", role: "canonical", text: "OpenAI" },
          { match: "phrase", role: "alias", text: "Open AI" },
          { match: "literal", role: "alias", text: "ChatGPT" },
        ],
        combine: "any",
      });
      assert.equal(result.outcome, "complete");
      if (result.outcome !== "complete") return;
      assert.ok(result.provenance.canonical.messages > 0);
      assert.ok(result.provenance.alias.messages > 0);
      assert.ok(result.metrics.messages > result.provenance.canonical.messages);
    } finally {
      database.close();
    }
  });
});

test("applies sender filters without exposing message bodies", () => {
  withCorpus((path) => {
    const database = openCorpusDatabase(path, { readOnly: true });
    try {
      const result = measureMessages(database, {
        ...OPENAI_QUERY,
        filters: { senderTypes: ["client"] },
      });
      assert.equal(result.outcome, "complete");
      assert.equal("text" in result, false);
      if (result.outcome === "complete") {
        assert.ok(result.metrics.messages > 0);
      }
    } finally {
      database.close();
    }
  });
});

test("returns incomplete without partial metrics when a limit is reached", () => {
  withCorpus((path) => {
    const database = openCorpusDatabase(path, { readOnly: true });
    try {
      const result = measureMessages(database, OPENAI_QUERY, {
        maxCandidateRows: 1,
        maxMilliseconds: 5_000,
      });
      assert.deepEqual(
        { outcome: result.outcome, reason: result.outcome === "incomplete" ? result.reason : null },
        { outcome: "incomplete", reason: "candidate_limit" },
      );
      assert.equal("metrics" in result, false);
    } finally {
      database.close();
    }
  });
});

test("normalization makes equivalent queries share one digest", () => {
  const first = normalizeQuery({
    clauses: [
      { match: "literal", role: "alias", text: " ChatGPT " },
      { match: "literal", role: "canonical", text: "OpenAI" },
    ],
    combine: "any",
    filters: { senderIds: ["internal-02", "internal-01"] },
  });
  const second = normalizeQuery({
    clauses: [
      { match: "literal", role: "canonical", text: "OpenAI" },
      { match: "literal", role: "alias", text: "ChatGPT" },
    ],
    combine: "any",
    filters: { senderIds: ["internal-01", "internal-02"] },
  });
  assert.deepEqual(first, second);
  assert.equal(queryDigest(first), queryDigest(second));

  const differentCase = normalizeQuery({
    clauses: [
      { match: "literal", role: "canonical", text: "OPENAI" },
      { match: "literal", role: "alias", text: "chatgpt" },
    ],
    combine: "any",
    filters: { senderIds: ["internal-01", "internal-02"] },
  });
  assert.equal(queryDigest(first), queryDigest(differentCase));
});
