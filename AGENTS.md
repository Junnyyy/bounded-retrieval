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
