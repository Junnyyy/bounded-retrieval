import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateCorpus } from "../corpus/generate.ts";
import { runDeterministicEvaluation } from "./run.ts";

test("records a bounded comparison against the naive full-row result", () => {
  const directory = mkdtempSync(join(tmpdir(), "bounded-retrieval-evaluation-"));
  const databasePath = join(directory, "fixture.sqlite");
  const outputPath = join(directory, "evaluation.json");
  try {
    const generated = generateCorpus({
      databasePath,
      profile: {
        days: 7,
        description: "Evaluation test fixture",
        messageCount: 4_000,
        name: "week",
        participantCount: 20,
        realistic: true,
      },
      seed: "evaluation-test",
    });
    const record = runDeterministicEvaluation({
      artifactDirectory: join(directory, "exports"),
      databasePath,
      groundTruth: generated.groundTruth,
      outputPath,
    });

    assert.ok(Object.values(record.assertions).every(Boolean));
    assert.ok(record.scenarios.frequency.naive.resultBytes > 16 * 1_024);
    assert.ok(record.scenarios.frequency.bounded.peakResultBytes <= 4 * 1_024);
    assert.ok(record.scenarios.clientConcerns.bounded.calls.length > 1);
    assert.ok(existsSync(outputPath));
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
