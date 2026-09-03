import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateCorpus } from "../corpus/generate.ts";
import { openCorpusDatabase } from "../database/corpus.ts";
import { naiveRegexSearch } from "./naive-search.ts";

test("naive baseline scans every row and emits every exact match", () => {
  const directory = mkdtempSync(join(tmpdir(), "bounded-retrieval-naive-"));
  const databasePath = join(directory, "fixture.sqlite");
  try {
    const generated = generateCorpus({
      databasePath,
      profile: {
        days: 7,
        description: "Naive search test fixture",
        messageCount: 2_000,
        name: "week",
        participantCount: 20,
        realistic: true,
      },
      seed: "naive-search-test",
    });
    const database = openCorpusDatabase(databasePath, { readOnly: true });
    try {
      const result = naiveRegexSearch(
        database,
        /(?<![\p{L}\p{N}])OpenAI(?![\p{L}\p{N}])/giu,
      );
      assert.equal(result.candidateRowsExamined, 2_000);
      assert.equal(
        result.matchingMessages,
        generated.groundTruth.openAi.matchingMessageCount,
      );
      assert.equal(
        result.occurrences,
        generated.groundTruth.openAi.occurrenceCount,
      );
      assert.equal(result.result.messages.length, result.matchingMessages);
      assert.ok(result.mcpResultBytes > 16 * 1_024);
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
