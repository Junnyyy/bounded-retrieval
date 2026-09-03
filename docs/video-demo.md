# Video demonstration outline

The demo should make the failure mode visible before showing the agent. A concise recording can fit in six to eight minutes.

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

As the agent works, identify the purpose of each call: ranked/thread-diverse discovery, optional distribution testing, and selected context reconstruction. If the agent makes a poor or redundant call, keep it in the recording—the service should remain bounded even when tool use is imperfect.

## 7. Close honestly

- The deterministic layer proves exactness and byte ceilings.
- The live run demonstrates agent behavior but does not make it deterministic.
- FX, the model, and SQLite indexing are replaceable.
- Future semantic retrieval would be estimated/model-derived and must not overwrite exact lexical semantics.
