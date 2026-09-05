import assert from "node:assert/strict";
import test from "node:test";

import { RESULT_LIMITS } from "../budget/limits.ts";
import {
  DisclosureBudgetExceededError,
  QueryReferenceError,
  QueryRegistry,
} from "./query-registry.ts";

const QUERY = {
  clauses: [{ match: "literal", role: "canonical", text: "OpenAI" }],
  combine: "any",
} as const;

test("reuses one process-scoped reference for equivalent queries", () => {
  const registry = new QueryRegistry("corpus-test");
  const first = registry.register(QUERY);
  const second = registry.register({
    clauses: [{ match: "literal", role: "canonical", text: " openai " }],
    combine: "any",
  });
  assert.equal(first.queryRef, second.queryRef);
  assert.equal(first.queryDigest, second.queryDigest);
});

test("tracks repeated response bytes and unique disclosed messages", () => {
  const registry = new QueryRegistry("corpus-test");
  const reference = registry.register(QUERY);
  registry.recordDisclosure(reference.queryRef, 1_000, ["message-1", "message-2"]);
  const state = registry.recordDisclosure(reference.queryRef, 500, ["message-2"]);
  assert.deepEqual(state.disclosure, {
    bytes: 1_500,
    messageCount: 2,
    remainingBytes: RESULT_LIMITS.cumulativeQueryBytes - 1_500,
  });
  assert.equal(registry.hasDisclosedMessage(reference.queryRef, "message-1"), true);
});

test("all/any on one normalized clause cannot create a fresh disclosure budget", () => {
  const registry = new QueryRegistry("corpus-test");
  const first = registry.register(QUERY);
  registry.recordDisclosure(first.queryRef, 2_000);
  const equivalent = registry.register({ ...QUERY, combine: "all", clauses: [...QUERY.clauses, ...QUERY.clauses] });
  assert.equal(equivalent.queryRef, first.queryRef);
  assert.equal(equivalent.disclosure.bytes, 2_000);
});

test("fails closed when cumulative disclosure would be exceeded", () => {
  const registry = new QueryRegistry("corpus-test");
  const reference = registry.register(QUERY);
  registry.recordDisclosure(
    reference.queryRef,
    RESULT_LIMITS.cumulativeQueryBytes - 10,
  );
  assert.throws(
    () => registry.recordDisclosure(reference.queryRef, 11),
    DisclosureBudgetExceededError,
  );
  assert.equal(registry.get(reference.queryRef).disclosure.remainingBytes, 10);
});

test("rejects unknown or expired references", () => {
  const registry = new QueryRegistry("corpus-test");
  assert.throws(() => registry.get("query_missing"), QueryReferenceError);
});
