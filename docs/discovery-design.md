# Discovery response design and evaluation

Status: reviewed design; the first implementation milestone is complete. The
sections below preserve the pre-implementation review and historical projections.
See [implementation results and the current contract](discovery-results.md).

## Objective

Minimize the total cost of reaching a supported answer while preserving accurate
retrieval, attribution, and explicit limits. Compare whole investigations: tool
calls, full MCP-compatible bytes, repeated evidence, and latency. Lower output
volume is not an improvement when it results from skipped evidence.

Keep the five existing tools, deterministic synthetic data, 16 KiB result ceiling,
48 KiB cumulative normalized-query budget, and separate measurement, ranked
discovery, sampling, expansion, and export contracts.

## Concrete comparison

The review question is: **What concerns did clients raise about OpenAI?**

The request is `discover_messages` with a canonical literal `OpenAI` clause,
`combine: all`, a client-sender filter, and a five-item limit. This query expresses
the entity and speaker population; it does not express concern-specific relevance.

The [complete comparison JSON](examples/discovery-response-comparison.json)
contains three response envelopes and evaluation metadata. Each envelope is an
independent first-call example, not a sequence sharing a disclosure budget.

| Example | Full MCP-compatible bytes | Distinct statements | Planted concern categories supported |
| --- | ---: | ---: | ---: |
| Current response, volatile values normalized | 11,430 | 1 | 0 of 5 |
| Proposed format, identical five evidence items | 9,398 | 1 | 0 of 5 |
| Format plus duplicate-aware selection preview | 10,154 | 5 | 0 of 5 |

The format-only projection is **17.78% smaller**, preserving the same evidence,
attribution, filter IDs, thread references, and daily distribution. The selection
preview uses 756 more bytes than that projection, including exact repeat counts,
but still fits below the current response size.

These are serialized design measurements, not measured improvements to a deployed
server or agent. No model was called. Neither projection passes the effectiveness
goal for the review question. Do not use these figures as a release benchmark.

### Before: repeated text in five evidence slots

All five current evidence items contain:

> OpenAI and OpenAI pricing both came up in the same call.

The message IDs are `message-000000223`, `message-000001000`,
`message-000005662`, `message-000005921`, and `message-000006180`.
They have distinct thread references, but the sentence does not establish a client
concern. A mention of pricing alone does not establish concern about pricing.

### After: conservative formatting

| Field decision | Purpose or consequence |
| --- | --- |
| Keep `message_ref` and `thread_ref` | Preserve citations, context anchors, and visible thread identity. |
| Keep sender ID, name, type, and organization | Preserve attribution and the ability to refine by sender. |
| Keep conversation ID, name, and type | Preserve source interpretation and conversation filtering. |
| Keep timestamp, matched roles, snippet, and clipping flag | Preserve chronology, canonical/alias provenance, and excerpt limitations. |
| Remove separate `message_id` | The stable message reference already identifies the message. Existing expansion accepts the reference. |
| Remove conversation reference | Conversation ID and name remain; the primary tools accept the ID as a filter. |
| Remove raw ranking score | Selection order and method remain. The score is not semantic confidence. |
| Omit empty/default query filters | Preserve active constraints; document omitted filters as unrestricted. |
| Keep full metrics and daily time buckets | Avoid saving bytes by hiding distribution information that could trigger an extra call. |
| Remove `duration_ms` from the model response | Collect execution timing outside model context during evaluation. |
| Replace `selection.complete` with `exhaustive` and `stop_reason` | Distinguish intentionally bounded selection from incomplete scanning. |
| Return an empty `next_actions` when no specific action is justified | Avoid generic encouragement to sample, expand, or export. Empty does not mean the answer is complete. |

The example retains the existing envelope for comparison. Before implementation,
version the changed result contract and define result-kind-specific schemas. MCP
clients must not have to infer a new field meaning under an unchanged documented
contract. This design does not add SDK APIs or upgrade dependencies.

### After: duplicate-aware selection preview

The preview returns these statements in the existing rank order:

1. OpenAI and OpenAI pricing both came up in the same call.
2. Please add @OpenAI to the comparison notes.
3. OpenAI's release schedule may affect our proposal.
4. OpenAI came up in today's account review.
5. The OpenAI-powered workflow performed well in the trial.

The scratch procedure compiles independent matchers per candidate, preserves
BM25/time/message-ID ordering, groups eligible rows by byte-identical **full text**,
and picks the first five rows with unseen text and unseen threads. It does not
deduplicate clipped snippets, paraphrases, or themes. No ground-truth label affects
selection.

Each representative includes `same_text_matches` counts for messages, senders,
conversations, and threads across the entire exact filtered population. For example,
the first statement occurs in 48 messages from 10 senders, across 10 conversations
and 48 threads. Those counts describe repeated text, not independent concerns or
theme prevalence. Only the representative's citation is disclosed and authorized
as an expansion anchor; aggregates do not authorize undisclosed anchors.

This preview fully scans the small fixture for exact group counts. A future
implementation must enforce execution limits and distinguish exact counts from
counts over a scanned subset. The design example is not an execution-budget model.

## What the comparison changes about the plan

Compact formatting and duplicate suppression are useful candidates, but they do
not resolve task relevance. Here, five distinct high-ranked mentions still miss
all five planted concerns. Do not describe the selection preview as an effective
answer to the review question.

Keep two independent comparisons:

1. **Formatting:** identical selected evidence, smaller serialization, no loss of
   necessary attribution, provenance, filters, or limitation information.
2. **Selection:** corrected matching, then compare unique relevant support,
   population coverage, and total investigation cost against that corrected base.

Before choosing a final discovery ranking, compare a direct discovery call with
an agent-written refined lexical query and with a justified sample call. Use the
existing surface first. Refining to the word `concern` alone is insufficient: valid
concerns may be phrased as questions or requirements. Extra calls and each distinct
query's bytes must count toward the investigation total even though the hard
48 KiB accounting boundary remains per normalized query.

If those paths cannot provide adequate support efficiently, evaluate a small
agent-supplied relevance signal as a separate design decision. Define whether it
changes eligibility or only ordering, preserve exact query semantics, and measure
its schema/prompt overhead. Do not silently insert theme labels, semantic
classification, or sampling into ranked discovery.

## Result-state contract to settle before implementation

| State | What the agent may conclude | What the result must expose |
| --- | --- | --- |
| Exact scan, bounded selection | Counts are exact for the lexical query; excerpts are a subset. | Exact metrics, selection method, stop reason, omitted count. |
| Exact scan, zero matches | The specified query matched nothing. | Zero counts; no suggestion to expand an absent anchor; no semantic absence claim. |
| Scan interrupted | The server did not establish exact population counts. | Incomplete outcome, execution-limit reason, no exact-looking subset totals. |
| Excerpt clipped | The displayed text is insufficient for a full-message claim. | Per-item clipping flag and a usable disclosed anchor. |
| Serialization removes selected items | Less evidence was disclosed than selection prepared. | Byte-limit reason and counts computed from the final transmitted set. |
| Disclosure budget exhausted | Further disclosure for this query is rejected. | A bounded error; no recommendation to reformulate solely to evade the budget. |
| Repeat request, later milestone | Evidence was already disclosed, not necessarily retained by the host. | Compact receipt or explicit redisclosure; every transmitted byte still counted. |

Multiple reasons may apply simultaneously: for example, an item-limited selection
can also be reduced by the byte cap. Preserve both. Do not infer task completion
from scan completion, a small sample, or an empty next-action list.

## Evaluation scenarios and acceptance gates

Ground truth belongs outside the tool-visible payload and selection algorithm.
Use the existing realistic month profile, supplemented by small deterministic
synthetic edge cases. Keep some wording and seed variations out of tuning runs.

| Scenario | Evidence/behavior requirement | Efficiency comparison |
| --- | --- | --- |
| Exact frequency | Correct occurrence, message, thread, and conversation counts; no text. | One measurement call; preserve the 4 KiB tool cap. |
| Existing client-concern question | Score support for each of the five planted categories; a generic mention is not supporting evidence. | Track coverage at one, two, and three calls and total bytes; do not accept zero-support discovery as a successful concern result. |
| Duplicate-heavy population | Distinct evidence slots; correct full-text repeat counts and representative citations. | Repeated snippet bytes and useful statements per response. |
| Repeated text from different clients | Preserve multiplicity and avoid attributing the whole group to one representative. | Compare aggregate metadata cost with redundant full evidence. |
| Rare late-period concern | Keep it eligible and test whether the investigation surfaces it or states its limitation. | Coverage across deterministic seeds at equal total bytes. |
| More time/conversation strata than sample slots | Selection must not systematically favor earliest or lexicographically first strata; describe the sampled unit honestly. | Distribution coverage, sample yield, and repeat rate. |
| Ambiguous reply | Include enough context for attribution and interpretation, or require expansion of a disclosed anchor. | Compare a selective expansion with any proposed inline parent excerpt. |
| Canonical term and aliases | Preserve roles and exact lexical semantics; no invented semantic coverage. | Count extra queries and bytes needed to resolve aliases. |
| Long text and Unicode | No unsafe byte overflow; full-text duplicates remain distinct when clipped excerpts coincide. | Usable evidence after full-envelope fitting. |
| No results or interrupted scan | Exact absence and unfinished search remain distinguishable. | Avoid unproductive expansion/sampling recommendations. |
| Repeated/equivalent query | Same hard disclosure budget; no accidental repeated full response if repeat suppression is later adopted. | New evidence and transmitted bytes per repeat; include redisclosure cases. |
| Exhaustive output | Export complete rows as an artifact; model receives metadata only. | Inline bytes independent of exported row count. |

Required gates for the first implementation milestone:

- Correct raw-text eligibility and counts, stable citation resolution, and safe
  disclosed-anchor expansion. Matcher eligibility must not depend on row order.
- Every response fits its tool ceiling and every equivalent-query sequence stays
  within 48 KiB. Measure both structured content and compatibility text together.
- Formatting comparisons use identical evidence. Selection comparisons use the
  corrected baseline, not the current matcher defect.
- No reduction in fixture evidence coverage is accepted merely for a byte saving.
  A claim that the concern investigation covered all themes requires support for
  all five planted categories. Partial coverage must be scored and described as
  partial. One-call coverage is an aspiration, not an assumed guarantee.
- Report total calls, serialized bytes, unique supporting references, duplicate
  text bytes, and time/conversation coverage. Instrument latency and candidate
  work across both selection and measurement passes, not just the selection loop.
- Changes that help one scenario and hurt another must report that tradeoff.
  Do not hide regressions behind a single average or an arbitrary weighted score.

Later live evaluation can compare neutral and guided instructions using one fixed
model and fresh sessions. Include tool definitions, call arguments, actual model
input tokens when available, response bytes, and unsupported claims. Wire bytes
and actual model input tokens are separate measurements. No live model or provider
run is included in this planning step.

## Implementation checkpoints after design review

1. Fix matching state and verify sampling behavior; add focused correctness cases.
2. Establish corrected deterministic baselines and evidence-quality scoring.
3. Apply the reviewed compact output contract; compare identical evidence.
4. Evaluate duplicate-aware discovery against the relevance scenarios before
   choosing its final ranking and multiplicity behavior.
5. Consider repeat suppression, targeted guidance, context previews, or caching
   only when an observed scenario justifies their added complexity.

The next design decision is the relevance comparison above. The format proposal
is ready to review; the duplicate-aware selector is a baseline candidate that
still fails the concern task, not a finished algorithm to implement unchanged.

## Provenance and reproduction notes

The source checkout was `0350b52`. Versions were verified from `package.json` and
`pnpm-lock.yaml`: Node 24.20.0, pnpm 11.18.0, MCP server 2.0.0, Zod 4.5.4,
TypeScript 7.0.2, and Node types 24.13.3. The scratch probe ran on Node 24.20.0.

The corpus uses the existing month profile and seed
`bounded-retrieval-evaluation-v1`, producing `corpus-4f6e4a3f4bb9439c`.
The unmodified service's first five-item discovery supplied `before`; the review
copy replaces the opaque query reference with a non-resolvable placeholder and
sets runtime timing to zero. All response/cumulative/remaining counters are then
recomputed to a stable serialized size. The JSON records every projection and the
selection procedure. Query handles in the artifact cannot be used in a live server.

For each envelope, measure the UTF-8 byte length of a minified object containing
`content: [{ text: JSON.stringify(envelope), type: "text" }]` and
`structuredContent: envelope`. Include both copies and their JSON escaping.
Repeat accounting until the embedded byte counters stabilize. The pretty-printed
review file, its explanatory metadata, and evaluation-only labels are not tool
responses and are not included in those per-response numbers.

Context7 was queried against the official SDK v2 and Node v24 documentation
collections. Those collections are version-line documentation, not immutable
patch-version snapshots. The design uses the structured-result mechanism already
present in the pinned checkout: [SDK v2 — Register a tool with structured output](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools),
[SDK v2 — Tool error response structure](https://ts.sdk.modelcontextprotocol.io/v2/servers/errors.md),
and [Node v24 — File system](https://nodejs.org/docs/latest-v24.x/api/fs.html).
