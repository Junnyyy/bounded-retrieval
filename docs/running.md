# Running the reference

Run commands from the repository root. All corpora are deterministic synthetic
Slack-style data. The server does not ingest real Slack data or read evaluation
labels. See the [README](../README.md) for the design and video demo.

## Runtime and dependencies

Use Node 24.20.0 and native pnpm 11.18.0, pinned in
[package.json](../package.json) and [.node-version](../.node-version).

```sh
pnpm install --frozen-lockfile
```

The frozen install preserves the committed dependency versions and fails if the
manifest and lockfile disagree. See [pnpm install: frozen lockfile](https://pnpm.io/cli/install#--frozen-lockfile).
Use native pnpm. If registry or socket restrictions block installation, report the
failure rather than bypassing them.

## Deterministic checks

```sh
pnpm check
pnpm evaluate -- --force
```

These commands require no model, provider credentials, or FX installation.
`pnpm check` runs type checking and the test suite. The evaluator regenerates the
40,000-message month fixture and writes `artifacts/evaluations/month.json` with
counts, bytes, call traces, and supported/missing categories. All five assertions
should pass. See [evaluation](evaluation.md) for expected results.

Generated artifacts are ignored by Git. The week demo uses a different corpus and
seed from this benchmark, so its counts will differ.

## Corpus profiles

| Profile | Span | Messages | Use |
| --- | ---: | ---: | --- |
| `week` | 7 days | 10,000 | Interactive demo |
| `month` | 30 days | 40,000 | Deterministic evaluation |
| `million` | 30 days | 1,000,000 | Artificial scale fixture |
| `stress` | 30 days | 10,000,000 | Artificial stress fixture |

Each profile has 20 people and one denormalized `messages` table with an FTS5 index.
Large profiles are available to generate; their availability does not establish
validated scale performance. The evaluator accepts only `week` and `month`.

```sh
pnpm seed -- --profile week
```

This writes `artifacts/corpora/week.sqlite` and a neighboring ground-truth JSON file.
Generation refuses to overwrite an existing corpus unless `--force` is supplied.
Use `--output` and `--seed` for a separate fixture.

## Optional interactive demo with FX

Install FX 0.0.7 separately using the
[official installation guide](https://fx.sh/docs/getting-started/installation#review-the-installer-before-running-it)
and configure your provider credentials. Then run:

```sh
pnpm fx
```

The repository runner verifies Node and FX versions, disables FX auto-upgrades,
generates the week corpus if absent, and launches FX. It does not download or update
FX. [.fx.json](../.fx.json) sets the host result limit to 32 KiB, above the server's
16 KiB ceiling, so host truncation cannot hide a server budget defect.

Review [.mcp.json](../.mcp.json), then approve the server in the FX shell:

```text
/mcp trust approve bounded-retrieval
```

See [FX MCP: project configuration and trust](https://fx.sh/docs/capabilities/mcp#project-configuration-and-trust).
Give the agent either the [neutral](../instructions/neutral.md) or
[guided](../instructions/guided.md) instructions. Use fresh sessions to compare them.

Example questions:

> How often did OpenAI come up? Distinguish occurrences, messages, threads, and conversations.

> What concerns did clients raise about OpenAI? Group the themes and cite the message references supporting each theme.

The first question can use one measurement call. For the second, inspect whether
the answer has relevant citations and whether each additional call resolves an
evidence gap. The [recorded live comparison](evaluation.md#live-agent-example)
shows the calls and measurement boundaries used in two sessions.

## Source map

| Directory | Responsibility |
| --- | --- |
| [src/corpus](../src/corpus/) | Synthetic generation and separate ground truth |
| [src/retrieval](../src/retrieval/) | Queries, exact verification, ranking, sampling, and context |
| [src/session](../src/session/) | Query references and disclosure accounting |
| [src/service](../src/service/) | Orchestration and full-result byte measurement |
| [src/mcp](../src/mcp/) | Schemas and five-tool stdio server |
| [src/evaluation](../src/evaluation/) | Baseline, evidence scoring, and deterministic comparison |
| [src/export](../src/export/) | Streaming JSONL exports |

See the [response reference](discovery-results.md) for field meanings and omission rules.
