import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { generateCorpus } from "../src/corpus/generate.ts";
import { CORPUS_PROFILES } from "../src/corpus/profiles.ts";

const EXPECTED_FX_VERSION = "0.0.7";
const EXPECTED_NODE_VERSION = "v24.20.0";
const DEFAULT_DATABASE_PATH = resolve("artifacts", "corpora", "week.sqlite");

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function verifyRuntime(): void {
  if (process.version !== EXPECTED_NODE_VERSION) {
    fail(
      `Expected Node ${EXPECTED_NODE_VERSION}, found ${process.version}. Activate the version in .node-version.`,
    );
  }

  const version = spawnSync("fx", ["--version"], {
    encoding: "utf8",
    env: { ...process.env, FX_AUTO_UPGRADE: "0" },
  });
  if (version.error !== undefined) {
    fail(
      [
        `FX ${EXPECTED_FX_VERSION} is required but was not found on PATH.`,
        "Install the pinned release using FX's documented installer:",
        `curl -fsSL https://fx.sh/setup.sh | bash -s -- v${EXPECTED_FX_VERSION}`,
      ].join("\n"),
    );
  }
  const output = `${version.stdout}${version.stderr}`;
  if (version.status !== 0 || !output.includes(EXPECTED_FX_VERSION)) {
    fail(
      `Expected FX ${EXPECTED_FX_VERSION}; version command returned ${JSON.stringify(output.trim())}`,
    );
  }
}

function ensureCorpus(): void {
  if (existsSync(DEFAULT_DATABASE_PATH)) return;
  process.stderr.write("Generating the default 10,000-message week corpus…\n");
  generateCorpus({
    databasePath: DEFAULT_DATABASE_PATH,
    profile: CORPUS_PROFILES.week,
    seed: "bounded-retrieval-v1",
  });
}

function main(): void {
  verifyRuntime();
  ensureCorpus();
  const launched = spawnSync("fx", [], {
    cwd: process.cwd(),
    env: { ...process.env, FX_AUTO_UPGRADE: "0" },
    stdio: "inherit",
  });
  if (launched.error !== undefined) throw launched.error;
  process.exitCode = launched.status ?? 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
