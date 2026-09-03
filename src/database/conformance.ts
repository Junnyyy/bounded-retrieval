import { DatabaseSync } from "node:sqlite";

export interface SqliteCapabilities {
  readonly fts5Enabled: boolean;
  readonly sqliteVersion: string;
}

export function inspectSqliteCapabilities(): SqliteCapabilities {
  const database = new DatabaseSync(":memory:");

  try {
    const versionRow = database
      .prepare("SELECT sqlite_version() AS version")
      .get() as { version: string };
    const ftsRow = database
      .prepare(
        "SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled",
      )
      .get() as { enabled: number };

    if (ftsRow.enabled === 1) {
      database.exec("CREATE VIRTUAL TABLE fts5_probe USING fts5(body)");
    }

    return {
      fts5Enabled: ftsRow.enabled === 1,
      sqliteVersion: versionRow.version,
    };
  } finally {
    database.close();
  }
}

export function assertSqliteCapabilities(): SqliteCapabilities {
  const capabilities = inspectSqliteCapabilities();

  if (!capabilities.fts5Enabled) {
    throw new Error(
      `SQLite ${capabilities.sqliteVersion} was built without FTS5 support`,
    );
  }

  return capabilities;
}
