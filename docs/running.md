# Running and exploring the reference

Start with the [README](../README.md) for the purpose, design, benchmarks, and
deterministic test workflow. This guide covers corpus options, the optional live
demo, and where to find the implementation. Run commands from the repository root.

## Runtime and dependencies

Use Node **24.20.0** and native pnpm **11.18.0**, as pinned in
[package.json](../package.json) and [.node-version](../.node-version).
Install the committed dependency versions with:

```sh
pnpm install --frozen-lockfile
```

The frozen install preserves the lockfile and rejects an inconsistent manifest.
See [pnpm install: frozen lockfile](https://pnpm.io/cli/install#--frozen-lockfile).
Use native pnpm; do not substitute npm, Yarn, Bun, or Corepack. If registry or socket
restrictions block installation, report the failure rather than bypassing them.

The implementation uses built-in `node:sqlite` and TypeScript type stripping;
`pnpm check` runs `tsc --noEmit` and `node:test`. Type stripping does not perform
type checking, so both checks matter. See [Node 24: type stripping](https://nodejs.org/docs/latest-v24.x/api/typescript.html#type-stripping)
and [Node 24: running tests from the command line](https://nodejs.org/docs/latest-v24.x/api/test.html#running-tests-from-the-command-line).
These are version-line documentation links; the repository pins exact releases.

## Corpus profiles

Every profile is deterministic synthetic Slack-style sales data with 20 people.
The canonical `messages` table includes message, sender, conversation, thread,
reply, and timestamp fields. Sender and conversation metadata is duplicated on
each row; there are no normalized user or conversation tables. Internal generator
metadata and an FTS5 index support reproducibility and retrieval.

| Profile | Span | Messages | Use |
| --- | ---: | ---: | --- |
| `week` | 7 days | 10,000 | Default interactive demo |
| `month` | 30 days | 40,000 | Default deterministic evaluation |
| `million` | 30 days | 1,000,000 | Artificial scale fixture |
| `stress` | 30 days | 10,000,000 | Artificial stress fixture |

Generate the default demo corpus explicitly:

```sh
pnpm seed -- --profile week
```

It writes `artifacts/corpora/week.sqlite` and a neighboring ground-truth JSON file.
The latter contains exact OpenAI counts and concern-category support IDs for
evaluation; the MCP server never reads it. Seed generation refuses to overwrite an
existing corpus unless you add `--force`. Use `--output` and `--seed` for a separate
fixture. Large profiles are available to generate, but are not validated scale
benchmarks merely because the generator supports them.

The evaluator accepts only `week` and `month`. Its default month fixture uses a
different seed and directory from the interactive demo:

```sh
pnpm evaluate -- --force
```

This regenerates `artifacts/evaluations/month.sqlite` and its ground truth, then
writes the comparison to `artifacts/evaluations/month.json`. All generated
artifacts are ignored by Git. Do not compare a week demo's counts with the
README's month benchmark.

## Optional interactive demo with FX

FX **0.0.7** is a separately installed chat harness. The deterministic tests and
evaluation do not require FX, a model, or provider credentials. A live agent session
uses your configured model; model selection remains outside the retrieval layer.
The intended provider path is AI Gateway, with no benchmark model selected yet.

Install the pinned FX release using the official installer:

```sh
curl -fsSL https://fx.sh/setup.sh | bash -s -- v0.0.7
pnpm fx
```

See [FX installation: review the installer before running it](https://fx.sh/docs/getting-started/installation#review-the-installer-before-running-it)
for the reviewable installation path and release-verification limitations. The
installer does not check a signature or published checksum.

The repository runner checks the Node and FX versions, disables FX auto-upgrades
for the process, generates the week corpus if absent, and launches FX. It never
downloads or updates FX. [.fx.json](../.fx.json) sets the host result limit to
32 KiB, above the server's 16 KiB ceiling, so host truncation cannot hide a server
budget defect.

Review [.mcp.json](../.mcp.json), then approve this server in the FX shell:

```text
/mcp trust approve bounded-retrieval
```

FX keeps the approval in private settings rather than the repository. See
[FX MCP: project configuration and trust](https://fx.sh/docs/capabilities/mcp#project-configuration-and-trust).

Give the agent one instruction profile before asking a question. Use separate
sessions when comparing them:

- [Neutral instructions](../instructions/neutral.md) describe the environment
  without prescribing a retrieval strategy.
- [Guided instructions](../instructions/guided.md) explain progressive disclosure
  and when another call can resolve an evidence gap.

For measurement, ask:

```text
How often did OpenAI come up? Distinguish occurrences, messages, threads, and conversations.
```

The efficient path is one `measure_messages` call with no message text.

For discovery, ask:

```text
What concerns did clients raise about OpenAI? Group the themes and cite the message references supporting each theme.
```

Look for relevant cited evidence, justified lexical refinements, optional sampling,
and selective context expansion. Small responses alone do not establish success;
the agent still has to choose useful queries and interpret the evidence. Follow
the [video demonstration outline](video-demo.md) to record both deterministic
results and live behavior.

## Source map

| Directory | Responsibility |
| --- | --- |
| [src/corpus](../src/corpus/) | Deterministic generation and separate ground truth |
| [src/retrieval](../src/retrieval/) | Structured queries, FTS candidates, exact verification, ranking, sampling, context |
| [src/session](../src/session/) | Process-scoped query references and cumulative disclosure accounting |
| [src/service](../src/service/) | Bounded orchestration and full-result byte measurement |
| [src/mcp](../src/mcp/) | Strict schemas and the five-tool stdio server |
| [src/evaluation](../src/evaluation/) | Naïve baseline, evidence-quality scoring, deterministic comparison |
| [src/export](../src/export/) | Streaming local JSONL exports |

For field meanings and omission rules, see the [version 2 response contract](discovery-results.md#response-contract-version-2).
