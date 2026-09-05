import assert from "node:assert/strict";
import test from "node:test";

import { RESULT_LIMITS, serializedBytes } from "../budget/limits.ts";
import { QueryRegistry } from "../session/query-registry.ts";
import { finalizeResult } from "./result-envelope.ts";

test("UTF-8 fitting accounts for both MCP copies and all applicable byte limits", () => {
  const registry = new QueryRegistry("synthetic-v1");
  const query = registry.register({ clauses: [{ match: "literal", role: "canonical", text: "OpenAI" }], combine: "all" });
  registry.recordDisclosure(query.queryRef, RESULT_LIMITS.cumulativeQueryBytes - 1_800);
  const items = ["😀".repeat(400), "😀".repeat(400)];
  const reasons = new Set<string>();
  const result = finalizeResult({
    maximumBytes: 2_000, messageIds: () => [], nextActions: [],
    omitted: () => 2 - items.length, outcome: "complete", queryRef: query.queryRef,
    registry, result: () => ({ items, stop_reasons: [...reasons] }), resultKind: "test",
    shrink: (limits) => {
      if (items.length === 0) return false;
      items.pop();
      for (const limit of limits) reasons.add(limit);
      return true;
    },
    truncated: () => items.length < 2,
  });
  assert.equal(result.bytes, serializedBytes(result.mcpResult));
  assert.equal(result.bytes, result.envelope.disclosure.response_bytes);
  assert.ok(result.bytes <= 1_800);
  assert.deepEqual([...reasons].sort(), ["query_byte_limit", "response_byte_limit"]);
  assert.equal(registry.get(query.queryRef).disclosure.bytes, RESULT_LIMITS.cumulativeQueryBytes - 1_800 + result.bytes);
});
