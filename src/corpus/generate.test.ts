import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openCorpusDatabase, readCorpusMetadata } from "../database/corpus.ts";
import { generateCorpus } from "./generate.ts";
import type { CorpusProfile } from "./profiles.ts";

const TEST_PROFILE: CorpusProfile = {
  days: 7,
  description: "A compact deterministic test fixture",
  messageCount: 2_000,
  name: "week",
  participantCount: 20,
  realistic: true,
};

test("generates a deterministic flat corpus and separate ground truth", () => {
  const directory = mkdtempSync(join(tmpdir(), "bounded-retrieval-corpus-"));
  const databasePath = join(directory, "fixture.sqlite");
  const groundTruthPath = join(directory, "truth.json");

  try {
    const result = generateCorpus({
      databasePath,
      groundTruthPath,
      profile: TEST_PROFILE,
      seed: "test-seed",
    });
    const database = openCorpusDatabase(databasePath, { readOnly: true });

    try {
      const row = database
        .prepare("SELECT COUNT(*) AS count FROM messages")
        .get() as { count: number };
      const ftsRow = database
        .prepare(
          "SELECT COUNT(*) AS count FROM messages_fts WHERE messages_fts MATCH ?",
        )
        .get("openai") as { count: number };
      const schemaRows = database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
        )
        .all() as readonly { name: string }[];

      assert.equal(row.count, TEST_PROFILE.messageCount);
      assert.ok(ftsRow.count >= result.groundTruth.openAi.matchingMessageCount);
      assert.deepEqual(readCorpusMetadata(database), result.metadata);
      assert.ok(schemaRows.some((schemaRow) => schemaRow.name === "messages"));
      assert.ok(schemaRows.some((schemaRow) => schemaRow.name === "messages_fts"));
    } finally {
      database.close();
    }

    const truthOnDisk = JSON.parse(
      readFileSync(groundTruthPath, "utf8"),
    ) as typeof result.groundTruth;
    assert.deepEqual(truthOnDisk, result.groundTruth);
    assert.ok(result.groundTruth.openAi.occurrenceCount > 0);
    assert.ok(result.groundTruth.concerns.length > 0);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("uses one canonical message table rather than normalized user tables", () => {
  const directory = mkdtempSync(join(tmpdir(), "bounded-retrieval-schema-"));
  const databasePath = join(directory, "fixture.sqlite");

  try {
    generateCorpus({
      databasePath,
      profile: { ...TEST_PROFILE, messageCount: 100 },
      seed: "schema-seed",
    });
    const database = openCorpusDatabase(databasePath, { readOnly: true });

    try {
      const columns = database
        .prepare("PRAGMA table_info(messages)")
        .all() as readonly { name: string }[];
      const columnNames = columns.map((column) => column.name);
      assert.ok(columnNames.includes("sender_name"));
      assert.ok(columnNames.includes("sender_organization"));
      assert.ok(columnNames.includes("conversation_name"));
      const normalizedTableCount = database
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name IN ('users', 'conversations')",
        )
        .get() as { count: number };
      assert.equal(normalizedTableCount.count, 0);
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});
