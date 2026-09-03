import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSqliteCapabilities,
  inspectSqliteCapabilities,
} from "./conformance.ts";

test("the active Node runtime provides SQLite with FTS5", () => {
  const capabilities = inspectSqliteCapabilities();

  assert.match(capabilities.sqliteVersion, /^3\./u);
  assert.equal(capabilities.fts5Enabled, true);
  assert.deepEqual(assertSqliteCapabilities(), capabilities);
});
