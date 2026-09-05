import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateCorpus } from "../corpus/generate.ts";
import { CORPUS_PROFILES } from "../corpus/profiles.ts";
import { BoundedRetrievalService } from "../service/bounded-retrieval-service.ts";
import { scoreEvidence } from "./evidence-quality.ts";

test("quality scoring requires visible labeled support and counts repeated excerpts", () => {
  const directory = mkdtempSync(join(tmpdir(), "bounded-quality-"));
  const databasePath = join(directory, "fixture.sqlite");
  const generated = generateCorpus({ databasePath, profile: CORPUS_PROFILES.week, seed: "quality" });
  const service = new BoundedRetrievalService(databasePath, join(directory, "exports"));
  try {
    const result = service.discoverMessages({
      clauses: [{ match: "phrase", role: "canonical", text: "pricing predictability" }],
      combine: "all",
    });
    const quality = scoreEvidence([result, result], generated.groundTruth);
    assert.deepEqual(quality.supportedCategories, ["pricing"]);
    assert.equal(quality.allCategoriesSupported, false);
    assert.ok(quality.repeatedExcerptBytes > 0);
    assert.equal(quality.visibleItems, quality.uniqueMessages * 2);

    const clipped = structuredClone(result);
    for (const evidence of clipped.envelope.result.evidence as { snippet_clipped: boolean }[]) {
      evidence.snippet_clipped = true;
    }
    assert.deepEqual(scoreEvidence([clipped], generated.groundTruth).supportedCategories, []);
    assert.deepEqual(scoreEvidence([], generated.groundTruth).supportedCategories, []);
  } finally {
    service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
