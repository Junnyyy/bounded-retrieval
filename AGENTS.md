# Bounded Retrieval project instructions

## Product boundary

- This repository is an open-source reference demonstration, not a supported product or reusable library.
- Use only deterministic synthetic Slack-style data. Never connect to Slack or ingest real workspace exports.
- Keep the canonical corpus as one denormalized SQLite `messages` table plus its FTS5 index.
- The agent interprets user intent. The server accepts structured queries and performs deterministic retrieval, measurement, filtering, ranking, sampling, and budgeting.
- Context safety is enforced before an MCP result leaves the server. FX compaction and host truncation are not safety controls.
- Exact, incomplete, and rejected outcomes must remain explicit. Never present partial work as exact.
- Do not add authentication, hosted deployment, UI work, embeddings, vector search, or multi-model benchmarking to V1.

## Tool contract

- Keep the primary MCP surface limited to `measure_messages`, `discover_messages`, `sample_messages`, `expand_message_context`, and `export_messages`.
- Every model-visible MCP result must fit within 16 KiB of serialized UTF-8 output.
- Equivalent normalized queries share a 48 KiB cumulative disclosure budget for the lifetime of the MCP server process.
- Query references are opaque and process-scoped. Evidence references are stable for a corpus version.
- `measure_messages` never returns message text. `export_messages` never returns exported rows inline.

## Toolchain

- Use Node 24.20.0, pnpm 11.18.0, and FX 0.0.7.
- Use native pnpm only. Do not substitute npm, Yarn, Bun, or Corepack.
- Do not bypass registry or socket firewalls. If pnpm networking fails, stop and report the failure.
- Use built-in `node:sqlite`, Node TypeScript type stripping, `tsc --noEmit`, and `node:test`.
- Pin direct dependencies exactly and commit `pnpm-lock.yaml`.
- FX is installed separately. `pnpm fx` may verify and launch it but must not download or update it.
- Measure full MCP-compatible result bytes, including both `structuredContent` and the compatibility text representation.
- FX's project `max_tool_result_bytes` stays above the server's 16 KiB ceiling so harness truncation cannot mask a server-budget defect.

## Evaluation

- Keep the naïve regex baseline evaluation-only; it must not appear in the primary MCP tool surface.
- The default deterministic evaluation uses the realistic 40,000-message month profile and makes no model or provider call.
- Separate deterministic retrieval claims from live agent quality claims. A bounded server cannot guarantee that an agent will choose efficient tools or synthesize evidence well.

## Workflow

- Make small, atomic commits at working checkpoints.
- Update this file when a durable project-specific constraint or learning emerges.
- Do not create a pull request unless explicitly requested.
- Avoid em dashes in project documentation.
- Keep the README centered on purpose, design reasoning, research, measured
  evidence, applying the lessons to other MCPs, and reproducible checks. Put
  detailed setup in `docs/running.md` and response semantics in
  `docs/discovery-results.md`. Verify README benchmark
  claims against a fresh default evaluation; the week demo uses a different seed
  and corpus from the month benchmark.
- The README demo uses a GitHub-hosted video attachment. Link other docs to the
  README demo and keep the duplicate MP4 out of the repository tree.

## Discovery evaluation learnings

- Match counting supplies snippet offsets in one pass. Keep eligibility independent
  of matcher cursor state and row order; a bounded sample must not become small
  because later valid rows were skipped.
- Sampling is over previously undisclosed messages. Seed the order of strata when
  there are more dates or conversations than slots; do not silently remove
  same-thread messages and change the sampled population.
- Thread diversity and distinct text do not establish task relevance. Evaluate
  qualitative support separately from byte savings using labels that remain
  outside tool results and retrieval decisions.
- Any duplicate grouping must compare full message text before clipping and state
  the population over which repeat counts were computed. A representative's
  attribution does not describe every sender in its group.
- Discovery counts selected duplicate groups during its existing exact measurement
  pass. Both passes share execution limits; return null group counts if measurement
  is incomplete. Group totals never authorize undisclosed expansion anchors.
- MCP response schema version 2 has tool-specific output schemas. Keep all reasons
  for truncation, including byte fitting, and compute omission counts from the
  transmitted selection. Preserve thread roots and anchors longest during context
  fitting.
- Normalize a single deduplicated clause to `combine: all` so equivalent `any`
  requests cannot create a separate disclosure budget.
- Evaluation schema version 2 scores visible category support and preserves the
  old fixed trace as `legacyClientConcerns`. The successful refined vocabulary is
  fixture-informed; seed checks do not establish live agent or language quality.

## FX measurement learnings

- Inspect an exact FX session ID for the saved tool trace. FX 0.0.7 `session last
  --json` can return only a summary; `session --id <id> --json` includes execution.
- Keep server core bytes, captured MCP bytes including SDK metadata, and FX tool
  output bytes separate. Include capability search and tool-selection calls in
  whole-run totals, and never present each-output-once bytes as model tokens.
- Missing per-run token or cost fields mean unavailable. Do not attribute a local
  24-hour usage aggregate to a single run.
- On macOS, sandboxed FX status can report missing authentication while the
  existing Keychain login works outside the sandbox; verify before asking for login.
- Keep current contracts and measured comparison evidence. Remove superseded
  design projections once the implementation report covers their decisions.
- Raw FX session exports can include local filesystem paths and host context.
  Keep them under ignored `artifacts/`; publish only curated example records.
