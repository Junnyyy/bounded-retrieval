# Evaluation

The deterministic experiment measures retrieval correctness, response bytes, and
visible evidence coverage. The live experiment records an agent's tool choices
and cited answer. Their corpora and byte boundaries differ.

## Deterministic method

The default evaluation uses 40,000 synthetic messages, seed
`bounded-retrieval-evaluation-v1`, and corpus `corpus-4f6e4a3f4bb9439c`. It makes no
model or provider call. Separate ground-truth labels identify five planted concern
categories. Retrieval never reads those labels.

Coverage requires fully visible evidence supporting a category. A generic mention
of pricing does not count as a pricing concern. Counts and bytes can be correct
while coverage remains poor.

Every byte total includes the structured result and its compatibility text copy.
Multi-call figures sum the individually bounded results. The evaluation-only regex
baseline scans all 40,000 rows and returns 1,159 matching messages in 1,069,038 bytes.
The baseline is not exposed as an MCP tool.

## Deterministic results

| Strategy | Calls | Response bytes | Supported categories |
| --- | ---: | ---: | ---: |
| Client-filtered discovery, up to 8 excerpts | 1 | 13,922 | 2 of 5 |
| Discovery of up to 5 excerpts, then two samples of up to 8 messages | 3 | 30,320 | 3 of 5 |
| Explicit lexical refinements | 3 | 17,122 | 5 of 5 |
| Former fixed discovery/sample/expansion sequence | 3 | 22,060 | 0 of 5 |

The refined recipe combines client-filtered `OpenAI` queries with the prefix
`concern`, literal `needs`, or literal `difficult`. These terms are hand-authored
and fixture-informed. Recovering all five categories does not show that an unaided
agent will choose those terms or generalize to other wording.

Frequency measurement uses one call and 4,086 bytes, with no message bodies. Its
counts match ground truth and its output is 99.62% smaller than the baseline.
The refined investigation is 98.40% smaller. These are output-size comparisons;
they do not establish equivalent answers from a model given the full-row baseline.

## Implementation comparison

The saved before/after comparison uses the same month corpus and recipes. The
baseline already includes matcher and sampler corrections.

| Strategy | Bytes before | Bytes after | Reduction | Categories before / after |
| --- | ---: | ---: | ---: | ---: |
| Discovery, up to 8 excerpts | 15,444 | 13,922 | 9.85% | 0 / 2 |
| Discovery of up to 5 excerpts, then two samples | 35,688 | 30,320 | 15.04% | 3 / 3 |
| Lexical refinements | 45,564 | 17,122 | 62.42% | 4 / 5 |

Call counts did not change. Formatting alone saved 17–19% for the same selected
evidence. Duplicate-aware selection then used some bytes for multiplicities and
distinct evidence. Broad discovery grew from the compact-only 12,598 bytes to
13,922 bytes while gaining support for two categories.

Saved records:

- [Corrected baseline](examples/corrected-discovery-baseline.json)
- [Formatting comparison](examples/compact-discovery-checkpoint.json)
- [Implementation comparison and seed checks](examples/discovery-implementation-results.json)

## Live agent example

Two fresh FX 0.0.7 sessions used `openai/gpt-5.6-luna` through AI Gateway. The request
asked for two distinct client concerns about OpenAI, citations, an answer under
150 words, and at most three retrieval calls. It prohibited local file reads,
terminal tools, exports, and repository changes.

Both used the default FX context, project instructions from `b2c9b76`, and the same
10,000-message week corpus, `corpus-5e230f570d08e494`, seeded with
`bounded-retrieval-v1`. The second prompt prepended the existing
[guided instructions](../instructions/guided.md). No additional concern-specific
fixture vocabulary was supplied.

| Measurement | Default FX | With guidance |
| --- | ---: | ---: |
| Retrieval calls | 3 | 2 |
| Capability search and tool-selection calls | 3 | 2 |
| Total tool calls | 6 | 4 |
| All tool-output bytes | 39,289 | 27,273 |
| User prompt bytes | 514 | 2,725 |
| Saved session elapsed time | 42.9 s | 20.6 s |
| Requested concerns supported by citations | 2 of 2 | 2 of 2 |

Both answers cited fully visible client messages for pricing predictability
(`message-000000001`) and difficulty switching providers (`message-000002013`).
Both citations match the synthetic ground truth. Both answers said the concerns
were not exhaustive; the guided answer also rejected a prevalence estimate.

### Tool choices

| Default run | FX output bytes |
| --- | ---: |
| Find capabilities | 10,331 |
| Load discovery schema | 224 |
| Discover literal `OpenAI AND client` | 3,779 |
| Load context-expansion schema | 234 |
| Expand the first result | 12,298 |
| Discover `OpenAI` with a client-sender filter | 12,423 |

The first query searched for the word `client` instead of filtering client senders.
Expansion added no support for the final concerns. The last call corrected the
filter and supplied both cited messages.

| Guided run | FX output bytes |
| --- | ---: |
| Find capabilities | 11,101 |
| Load discovery schema | 224 |
| Discover `OpenAI AND concern` with a client-sender filter | 3,525 |
| Broaden to `OpenAI`, keeping the filter | 12,423 |

Guidance helped the agent use the sender filter immediately and avoid expansion.
Total tool-output bytes fell 30.58%, with 2,211 additional prompt bytes. The final
broad query alone contained both concerns, so both runs still made avoidable calls.

### Full-row comparison

Both final queries matched the same 105 client messages. An offline comparison
serialized all 105 rows with the same query, structured/text representations, SDK
metadata, and FX wrapper.

| Output | Bytes |
| --- | ---: |
| Offline full-row reply | 97,823 |
| Actual final discovery reply | 12,423 |
| Entire default tool trace | 39,289 |
| Entire guided tool trace | 27,273 |

The final discovery reply was 87.30% smaller and supported both requested concerns.
The full-row payload was not sent to a model.

### Measurement boundaries

| Boundary | Default FX | With guidance |
| --- | ---: | ---: |
| Server core MCP-compatible retrieval results | 27,874 | 15,534 |
| Captured MCP retrieval results, including SDK metadata | 28,228 | 15,770 |
| Retrieval results with FX wrapping | 28,500 | 15,948 |
| Capability search and tool-selection outputs | 10,789 | 11,325 |

All captured retrieval responses fit their tool caps. FX truncated none. Output
bytes count each result once, excluding input arguments, prompts, injected tool
schemas, and repeated inclusion in later model requests.

This was one session per condition, with no retrieval code change between runs.
Elapsed time comes from saved creation and update timestamps. It does not establish
a latency improvement. Per-run model tokens and cost were unavailable; FX's
24-hour usage aggregate includes unrelated work and cannot substitute for them.

The [default record](examples/fx-discovery-run.json) and
[guided record](examples/fx-guided-run.json) contain exact prompts, answers, session
IDs, timestamps, calls, captured results, byte accounting, and citation checks.
Raw local exports remain in ignored `artifacts/fx/`. Committed records omit personal
skill-catalog payloads but retain their byte counts and hashes.

## Verification

Follow the [running guide](running.md#deterministic-checks) to reproduce the default
evaluation. It writes current traces and totals to `artifacts/evaluations/month.json`.
All five assertions pass: exact counts, response caps, frequency reduction, query
budgets, and refined concern coverage.

The check suite covers exact matching, sampling, duplicate attribution, UTF-8 byte
fitting, omission counts, and anchor access, including real MCP stdio calls to all
five tools. Saved checks on a new week seed and two new month seeds recover all
five categories with the fixed recipe. They reuse wording templates and do not
establish language generalization.

## Additional seed checks

A fresh default run and three additional seeds tested whether the deterministic
results changed with fixture variation. No model was called and no retrieval code
changed. All five assertions passed on every run.

| Seed | Profile | Discovery (limit 8) categories | Discovery (limit 5) plus samples categories | Refined categories | Refined bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| `bounded-retrieval-evaluation-v1` | Month | 2 | 3 | 5 | 17,122 |
| `research-check-a` | Month | 2 | 2 | 5 | 17,168 |
| `research-check-b` | Month | 2 | 3 | 5 | 17,070 |
| `research-check-c` | Week | 2 | 3 | 5 | 12,962 |

These are different retrieval recipes, not a controlled test of adding sampling
to the same discovery result. Standalone discovery requests eight excerpts. The
sampling recipe requests five excerpts, then two samples of up to eight messages
each. Its initial five excerpts support zero planted categories in every run;
sampling increases that coverage to two or three. It therefore improves its own
starting selection in all four runs, while still missing some planted categories.

The sampling recipe used 28,394–30,398 bytes across the additional seeds. The fixed
refinement vocabulary remained effective, but every seed reused the generator's
wording templates. This tests fixture variation, not independent language or
agent query selection.

The [curated results](examples/research-seed-checks.json) contain corpus versions,
assertions, bytes, supported/missing categories, and a reproduction command.
Full local traces remain in ignored `artifacts/evaluations/`.

## Broader live investigation

A fresh FX 0.0.7 session asked for distinct supported client concerns without a
target theme count, allowed at most six retrieval calls, and required citations
and coverage limits in fewer than 300 words. It used the same 10,000-message week
corpus as the earlier live example. The configured model was
`openai/gpt-5.6-luna-fast`, with default FX and current project context and no guided
profile prepended. The prompt prohibited file reads, terminal commands, web search,
exports, modifications, and delegation.

| Measurement | Observed |
| --- | ---: |
| Retrieval calls | 5 |
| Capability search and tool-selection calls | 4 |
| Total tool-output bytes | 42,997 |
| Captured MCP retrieval bytes, including SDK metadata | 31,382 |
| Server core retrieval bytes | 30,792 |
| Saved session elapsed | 50.9 s |
| Planted categories with visible and cited support | 1 of 5 |

### What the agent did

The first query required literal `OpenAI` and `client`, with no sender filter. It
found 39 messages sharing the same vendor-approval wording. The agent expanded one
result, then searched for `OpenAI` and `security`, which supplied a data-privacy
concern. It sampled across conversations from the original narrow query and ended
with an empty `OpenAI` plus `compliance` search. It marked the added words as aliases
even though they were topical constraints, another mismatch between the query
schema's meaning and the agent's use of it.

All five retrieval calls succeeded. Captured MCP replies fit their tool caps and
FX truncated no tool output. The largest cumulative query disclosure was 25,850
bytes, below 48 KiB. Server-side selection remained non-exhaustive; a complete scan
was not a complete disclosure.

### What the answer established

The answer cited data privacy (`message-000000504`) and vendor approval
(`message-000003923`). Both were fully visible client-sender messages, and both
texts match the corpus. Only data privacy belongs to the five planted categories.
Vendor approval is supported by its text but lies outside those labels, so it is
not counted as a false finding. Neither the retrieved evidence nor the final
citations covered pricing, reliability, model quality, or vendor lock-in.

The agent correctly declined prevalence and completeness claims. However, its
39-message population was defined by the word `client`, not client authorship.
Sampling that same population could not fix the original filter choice. Context
expansion supplied no additional planted category. The server enforced its limits,
but the investigation missed most of the labelled concerns.

This is a diagnostic case, not a controlled comparison with the earlier sessions:
the prompt, project context, and model differ. Per-run tokens and cost remained
unavailable. The [curated record](examples/fx-broad-investigation.json) includes the
exact prompt, answer, call arguments, captured retrieval results, citation checks,
and output hashes. Personal capability-search payloads are omitted while their
bytes remain in the totals.
