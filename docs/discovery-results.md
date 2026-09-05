# Discovery implementation results

The first reviewed milestone is implemented: reliable matching and sampling,
evidence-quality evaluation, compact versioned responses, and discovery diversified
by full message text and thread. The five MCP tools and disclosure ceilings remain
the reference's boundaries.

## Measured result

The comparison uses the realistic 40,000-message month corpus,
`corpus-4f6e4a3f4bb9439c`, with seed `bounded-retrieval-evaluation-v1`.
The baseline already includes the matcher and sampler corrections. Each number
includes the whole MCP-compatible tool response: structured content and its text
compatibility representation.

| Investigation | Calls before / after | Bytes before | Bytes after | Reduction | Concern categories before / after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Broad ranked discovery | 1 / 1 | 15,444 | 13,922 | 9.85% | 0 / 2 |
| Ranked discovery plus two distribution samples | 3 / 3 | 35,688 | 30,320 | 15.04% | 3 / 3 |
| Explicit lexical refinements | 3 / 3 | 45,564 | 17,122 | 62.42% | 4 / 5 |

There are five planted concern categories. Only fully visible labeled support
counts toward coverage. A generic mention of pricing does not count as a pricing
concern. Ground-truth labels are used by evaluation only.

The refined recipe uses client-filtered `OpenAI` queries combined with the prefix
`concern`, literal `needs`, or literal `difficult`. Those terms are hand-authored
and fixture-informed. This is a reproducible retrieval experiment, not evidence
that an unaided agent will choose those terms or generalize to different wording.

Formatting alone reduced the same selected evidence by 17–19%, as recorded in the
[formatting checkpoint](examples/compact-discovery-checkpoint.json). Duplicate-aware
selection then spends some bytes on exact source multiplicities and distinct
evidence. For example, broad discovery increases from the compact-only 12,598 bytes
to 13,922 bytes while moving from zero to two supported categories. That is an
explicit effectiveness tradeoff, not an across-the-board byte reduction.

Exact frequency remains one call without message bodies, at 4,086 bytes within its
4 KiB cap. Time-bucket omission remains explicit when measurement output is fitted.

The current evaluator reports the refined recipe as `scenarios.clientConcerns`,
and retains the former fixed discover/sample/expand trace as
`scenarios.legacyClientConcerns`. That old trace still retrieves no planted concern
support in this fixture. Its small output is not treated as a successful answer.

## Implementation decisions

- Matching counts occurrences and records the first offset in one pass. Snippet
  extraction cannot advance a shared matcher and hide later eligible messages.
- Sampling uses seeded message priorities. Time and conversation strata are also
  ordered by seeded priority, so a small sample does not always visit the earliest
  dates or alphabetically first conversations. Same-thread messages remain eligible
  because the sampled unit is a message.
- Ranked discovery admits at most one representative per exact full text and
  thread. The measurement pass counts the selected full-text groups over the entire
  exact query population. Group counts are null when that scan is incomplete.
- The two discovery passes share candidate/time budgets, and the exposed examined
  row count includes both passes. Exact repeat counts do not require a third scan.
- Normalization collapses `all` and `any` for one deduplicated clause into the same
  query identity and disclosure budget.
- Context fitting keeps the anchor and thread root longest, removes distant
  neighbors first, and reports final before/after clipping and exact omitted rows.
  A one-message request returns only the anchor.

## Response contract, version 2

Each tool advertises its own strict output schema. Successful results retain the
shared envelope, stable corpus/query references, byte limits, disclosure counters,
outcome, omission count, and truncation flag.

Evidence references are stable for a corpus version. Query references are opaque
and process-scoped; equivalent normalized queries share one reference and budget.

Discovery and sample evidence retain stable message/thread references, sender
and conversation attribution/IDs, timestamps, lexical match roles, snippets, and
per-item clipping. They omit the redundant message ID, conversation reference, and
raw rank. Query output omits unrestricted filters. Execution timing is measured
outside the model-visible result by evaluation.

The fields have deliberately separate meanings:

| Field | Meaning |
| --- | --- |
| `outcome` | Whether the required scan completed. It is not task success. |
| `selection.exhaustive` | Whether all eligible messages were returned; it does not certify semantic completeness or unclipped text. |
| `stop_reasons` | All applicable item, execution, byte, window, or text limits. Multiple reasons may coexist. |
| `same_text_matches` | Exact message/sender/conversation/thread multiplicities for the representative's full text within the filtered query, or null when unknown. |
| Sample `population` | Previously undisclosed eligible messages and strata; counts are null for incomplete scans. |
| `returned_strata` | Strata represented in the final transmitted sample, after byte fitting. |
| `next_actions` | Specific guidance when incomplete scans or clipped evidence justify it. Empty does not mean the question is answered. |

`omitted` counts messages for discovery and context, eligible undisclosed messages
for a complete sample, and time buckets for measurement. It is null when unknown
or inapplicable. Discovery's aggregate repeat counts do not reduce its omitted
message count: those rows were counted, not individually disclosed.

Only transmitted message references authorize expansion. Group membership,
selected-but-removed rows, and exact aggregate counts do not grant anchor access.
Repeated calls continue to consume the shared query budget; the server does not
assume that previously transmitted context is still retained by the host.

## Verification

`pnpm check` passes type checking and 41 tests, including actual MCP stdio calls to
all five tools. Checks cover shared matcher state, aliases, row-order independence,
sample population coverage across seeds, same-thread sampling, exact duplicate
multiplicity, repeated-text attribution, rare late-period evidence, clipped
excerpts with different full texts, interrupted counts, UTF-8 envelope fitting,
final omission counts, and undisclosed-anchor rejection.

The default month evaluation passes all five assertions: exact counts, tool byte
ceilings, frequency reduction, query budgets, and full refined concern coverage.
Additional verification uses a new week seed and two new month seeds. All recover
the five categories with the fixed refined recipe and remain within the caps.
These seed checks reuse the corpus's wording templates and do not establish
language generalization.

Artifacts:

- [Corrected baseline](examples/corrected-discovery-baseline.json)
- [Formatting-only checkpoint](examples/compact-discovery-checkpoint.json)
- [Implementation comparison and seed verification](examples/discovery-implementation-results.json)

To reproduce the default deterministic run, use the repository's `pnpm check` and
`pnpm evaluate -- --force` commands. Complete current traces are written to ignored
`artifacts/evaluations/month.json`.

## Further work considered

The measured improvement is in response bytes and evidence quality; these
comparisons do not reduce the number of calls. Actual model input tokens,
tool-definition overhead, tool-choice quality, and final answer quality require
later live harness evaluation. No model or provider call was made here.

Repeat receipts with explicit redisclosure, automatic parent excerpts, and caching
remain later options. A repeat receipt needs a host-retention/redisclosure contract;
automatic parent context needs a demonstrated interpretation benefit; caching needs
scale measurements that justify extra state. The present refined fixture can be
answered from its excerpts, and its retrieval calls take milliseconds on the tested
machine. These options are not required to establish the current milestone.

No extra relevance parameter was needed for this benchmark. Broad lexical discovery
still has incomplete semantic coverage, and that limit stays visible in evaluation.

## Documentation basis

The implementation retains the pinned Node 24.20.0, pnpm 11.18.0, MCP server 2.0.0,
Zod 4.5.4, and TypeScript 7.0.2 toolchain. Context7 was consulted before coding using
the official version-line documentation collections; they are not immutable patch
snapshots. APIs were also verified by type checking and actual stdio execution.
Relevant sections are [SDK v2 — Register a tool with structured output](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools),
[SDK v2 — Tool error response structure](https://ts.sdk.modelcontextprotocol.io/v2/servers/errors.md),
[Zod 4 — Define a strict schema](https://zod.dev/error-formatting), and
[Node v24 — Test runner](https://nodejs.org/docs/latest-v24.x/api/test.html).
