# Future video recording outline

These are notes for the maintainer to use when recording later. No video is
included in the project. The recording should make the failure mode visible before
showing the agent; a concise version can fit in six to eight minutes.

Complete the [runtime and FX setup](running.md) first. The live demo uses the week
corpus; the benchmark below uses a separate month corpus and seed.

## 1. Establish the boundaries

- Show that the repository contains no Slack connector or import path.
- State that every message is generated locally and deterministically.
- Show the single denormalized `messages` table and explain why duplicated metadata is intentional.
- State the thesis: rows examined and bytes shown to the model are separate quantities.

## 2. Run the deterministic comparison

Run:

```sh
pnpm check
pnpm evaluate -- --force
```

Call out the ground-truth count, 16 KiB per-result ceiling, 48 KiB per-query ceiling, naïve full-row result size, bounded result size, and reduction percentage. Be explicit that this phase calls no model.

Also show supported and missing concern categories in `discoveryExperiments`. The refined recipe is hand-authored and fixture-informed. Contrast it with the broad ranked and sampled traces; do not present small responses as effective when they lack relevant support. The former fixed sequence is retained as `scenarios.legacyClientConcerns`.

## 3. Show the naïve failure

Open `artifacts/evaluations/month.json`. Explain that the evaluation-only regex baseline returns all matching denormalized rows as one MCP-compatible result. On the reference fixture that is over one megabyte before the agent has decided which evidence matters.

Do not add the naïve operation to the production MCP surface. Its purpose is comparison, not temptation.

## 4. Launch the replaceable harness

Run:

```sh
pnpm fx
```

Review and approve the project MCP server when FX prompts. Show `/mcp` so viewers can see the five purpose-specific tools. Mention that FX is the interface, not the safety boundary; the MCP service enforces its limits before FX receives a result.

## 5. Demonstrate measurement

Use the guided instructions, then ask:

```text
How often did OpenAI come up? Distinguish occurrences, messages, threads, and conversations.
```

Highlight that the answer requires one aggregation result and zero message bodies. Compare its tool-result bytes to the naïve baseline.

## 6. Demonstrate progressive disclosure

Ask:

```text
What concerns did clients raise about OpenAI? Group the themes and cite the message references supporting each theme.
```

As the agent works, identify the purpose of each call: discovery diversified by full text and thread, justified lexical refinement, optional distribution testing, and selected context reconstruction. Show repeat counts separately from the representative's attribution. If the agent makes a poor or redundant call, keep it in the recording—the service should remain bounded even when tool use is imperfect.

## 7. Close honestly

- The deterministic layer proves exactness and byte ceilings.
- The live run demonstrates agent behavior but does not make it deterministic.
- FX, the model, and SQLite indexing are replaceable.
- Future semantic retrieval would be estimated/model-derived and must not overwrite exact lexical semantics.
