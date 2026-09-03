import { resolve } from "node:path";

import { generateCorpus } from "../corpus/generate.ts";
import {
  CORPUS_PROFILES,
  resolveCorpusProfile,
} from "../corpus/profiles.ts";

interface SeedArguments {
  readonly force: boolean;
  readonly output: string;
  readonly profile: string;
  readonly seed: string;
}

function parseArguments(arguments_: readonly string[]): SeedArguments {
  let force = false;
  let output: string | undefined;
  let profile = "week";
  let seed = "bounded-retrieval-v1";

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];

    if (argument === "--") {
      continue;
    } else if (argument === "--force") {
      force = true;
    } else if (argument === "--output" && value !== undefined) {
      output = value;
      index += 1;
    } else if (argument === "--profile" && value !== undefined) {
      profile = value;
      index += 1;
    } else if (argument === "--seed" && value !== undefined) {
      seed = value;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }

  return {
    force,
    output: output ?? resolve("artifacts", "corpora", `${profile}.sqlite`),
    profile,
    seed,
  };
}

function main(): void {
  const arguments_ = parseArguments(process.argv.slice(2));
  const profile = resolveCorpusProfile(arguments_.profile);
  const result = generateCorpus({
    databasePath: arguments_.output,
    overwrite: arguments_.force,
    profile,
    seed: arguments_.seed,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        database: result.databasePath,
        groundTruth: result.groundTruthPath,
        messages: result.metadata.messageCount,
        profile: result.metadata.profile,
        version: result.metadata.version,
      },
      null,
      2,
    )}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}

export { CORPUS_PROFILES };
