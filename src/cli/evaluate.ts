import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  generateCorpus,
  type CorpusGroundTruth,
} from "../corpus/generate.ts";
import { resolveCorpusProfile } from "../corpus/profiles.ts";
import { runDeterministicEvaluation } from "../evaluation/run.ts";

interface Arguments {
  readonly databasePath: string;
  readonly force: boolean;
  readonly outputPath: string;
  readonly profile: string;
  readonly seed: string;
}

function parseArguments(values: readonly string[]): Arguments {
  let force = false;
  let profile = "month";
  let seed = "bounded-retrieval-evaluation-v1";
  let databasePath: string | undefined;
  let outputPath: string | undefined;

  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    const value = values[index + 1];
    if (argument === "--") {
      continue;
    } else if (argument === "--force") {
      force = true;
    } else if (argument === "--profile" && value !== undefined) {
      profile = value;
      index += 1;
    } else if (argument === "--seed" && value !== undefined) {
      seed = value;
      index += 1;
    } else if (argument === "--database" && value !== undefined) {
      databasePath = value;
      index += 1;
    } else if (argument === "--output" && value !== undefined) {
      outputPath = value;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }

  if (profile !== "week" && profile !== "month") {
    throw new Error(
      "Deterministic evaluation accepts the realistic week or month profile only",
    );
  }
  return {
    databasePath:
      databasePath ?? resolve("artifacts", "evaluations", `${profile}.sqlite`),
    force,
    outputPath:
      outputPath ?? resolve("artifacts", "evaluations", `${profile}.json`),
    profile,
    seed,
  };
}

function main(): void {
  const arguments_ = parseArguments(process.argv.slice(2));
  const profile = resolveCorpusProfile(arguments_.profile);
  const groundTruthPath = `${arguments_.databasePath}.ground-truth.json`;
  if (arguments_.force || !existsSync(arguments_.databasePath)) {
    generateCorpus({
      databasePath: arguments_.databasePath,
      overwrite: arguments_.force,
      profile,
      seed: arguments_.seed,
    });
  }
  if (!existsSync(groundTruthPath)) {
    throw new Error(`Ground truth not found at ${groundTruthPath}`);
  }
  const groundTruth = JSON.parse(
    readFileSync(groundTruthPath, "utf8"),
  ) as CorpusGroundTruth;
  const record = runDeterministicEvaluation({
    artifactDirectory: resolve("artifacts", "exports"),
    databasePath: arguments_.databasePath,
    groundTruth,
    outputPath: arguments_.outputPath,
  });
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  if (Object.values(record.assertions).some((passed) => !passed)) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
