import { DatabaseSync } from "node:sqlite";

import { assertSqliteCapabilities } from "./conformance.ts";

export interface CorpusMetadata {
  readonly generatedAt: string;
  readonly messageCount: number;
  readonly profile: string;
  readonly realistic: boolean;
  readonly seed: string;
  readonly version: string;
}

export function openCorpusDatabase(
  path: string,
  options: { readonly readOnly?: boolean } = {},
): DatabaseSync {
  assertSqliteCapabilities();

  const database = new DatabaseSync(path, {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    readOnly: options.readOnly ?? false,
  });
  database.exec("PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;");
  return database;
}

export function readCorpusMetadata(database: DatabaseSync): CorpusMetadata {
  const rows = database
    .prepare("SELECT key, value FROM corpus_metadata ORDER BY key")
    .all() as readonly { key: string; value: string }[];
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  if (
    values.generated_at === undefined ||
    values.message_count === undefined ||
    values.profile === undefined ||
    values.realistic === undefined ||
    values.seed === undefined ||
    values.version === undefined
  ) {
    throw new Error("Corpus metadata is incomplete");
  }

  return {
    generatedAt: values.generated_at,
    messageCount: Number.parseInt(values.message_count, 10),
    profile: values.profile,
    realistic: values.realistic === "true",
    seed: values.seed,
    version: values.version,
  };
}
