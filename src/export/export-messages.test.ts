import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateCorpus } from "../corpus/generate.ts";
import type { CorpusProfile } from "../corpus/profiles.ts";
import { openCorpusDatabase } from "../database/corpus.ts";
import { countOpenAiMentions } from "../domain/openai-mentions.ts";
import { normalizeQuery } from "../retrieval/query.ts";
import { exportMessages } from "./export-messages.ts";

const PROFILE: CorpusProfile = {
  days: 7,
  description: "export test fixture",
  messageCount: 5_000,
  name: "week",
  participantCount: 20,
  realistic: true,
};

const QUERY = normalizeQuery({
  clauses: [{ match: "literal", role: "canonical", text: "OpenAI" }],
  combine: "any",
});

test("exports every exact row to deterministic JSONL", () => {
  const directory = mkdtempSync(join(tmpdir(), "bounded-retrieval-export-"));
  const databasePath = join(directory, "fixture.sqlite");
  try {
    const generated = generateCorpus({
      databasePath,
      profile: PROFILE,
      seed: "export-seed",
    });
    const database = openCorpusDatabase(databasePath, { readOnly: true });
    try {
      const result = exportMessages(database, QUERY, join(directory, "exports"));
      assert.equal(result.outcome, "complete");
      if (result.outcome !== "complete") return;

      const contents = readFileSync(result.artifactPath, "utf8");
      const lines = contents.trimEnd().split("\n");
      const rows = lines.map((line) => JSON.parse(line) as {
        message_id: string;
        text: string;
      });
      assert.equal(rows.length, generated.groundTruth.openAi.matchingMessageCount);
      assert.ok(rows.every((row) => countOpenAiMentions(row.text) > 0));
      assert.equal(
        createHash("sha256").update(contents).digest("hex"),
        result.sha256,
      );
      assert.equal(
        result.messageIdsSha256,
        generated.groundTruth.openAi.matchingMessageIdsSha256,
      );
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("removes partial artifacts when export limits are reached", () => {
  const directory = mkdtempSync(join(tmpdir(), "bounded-retrieval-export-"));
  const databasePath = join(directory, "fixture.sqlite");
  try {
    generateCorpus({ databasePath, profile: PROFILE, seed: "limited-export" });
    const database = openCorpusDatabase(databasePath, { readOnly: true });
    try {
      const result = exportMessages(
        database,
        QUERY,
        join(directory, "exports"),
        { maxCandidateRows: 1, maxMilliseconds: 60_000 },
      );
      assert.deepEqual(result, {
        candidateRowsExamined: 2,
        outcome: "incomplete",
        reason: "candidate_limit",
      });
      const exportDirectory = join(directory, "exports");
      assert.equal(existsSync(exportDirectory), true);
      assert.deepEqual(readdirSync(exportDirectory), []);
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});
