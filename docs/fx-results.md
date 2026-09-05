# Brief FX discovery comparison

Two actual FX **0.0.7** sessions used **openai/gpt-5.6-luna** through AI Gateway to
answer the same brief question. Both found the same two supported client concerns.
Adding the existing guided instructions reduced total tool calls from **6 to 4**
and tool-output bytes by **30.58%**, while adding **2,211 prompt bytes**.

| Measurement | Default FX | FX with guided instructions |
| --- | ---: | ---: |
| Retrieval calls | 3 | 2 |
| FX capability search / tool-selection calls | 3 | 2 |
| Total tool calls | 6 | 4 |
| All FX tool-output bytes | 39,289 | 27,273 |
| User prompt text bytes | 514 | 2,725 |
| Saved session elapsed time | 42.9 s | 20.6 s |
| Requested concerns supported by citations | 2 of 2 | 2 of 2 |

This is **one fresh session per condition**, illustrating observed behavior. It is
not a statistically reliable latency or agent-quality benchmark, and no retrieval
code changed between runs. Model tokens and cost were unavailable per run.

## Question and conditions

The question asked for two distinct client concerns about OpenAI, with citations,
an answer under 150 words, and at most three retrieval calls. It prohibited local
file reads, terminal tools, exports, and repository changes.

Both sessions used the default FX context, the same project instructions from
`b2c9b76`, the same model, and the same 10,000-message week corpus. The second prompt
prepended [instructions/guided.md](../instructions/guided.md) to the original question.
No concern-specific fixture vocabulary was supplied beyond that existing guidance.
The corpus is `corpus-5e230f570d08e494`, seeded with `bounded-retrieval-v1`; it is
different from the month benchmark.

## Answers and evidence

Both answers identified:

- **Pricing predictability as usage grows**, citing `message-000000001`:
  “Our main OpenAI concern is pricing predictability as usage grows.”
- **Difficulty switching providers later**, citing `message-000002013`:
  “Does adopting OpenAI make it difficult to switch providers later?”

Both citations refer to fully visible client messages returned by the tools and
match the synthetic ground truth. Both answers state that the concerns are not
exhaustive; the guided answer also explicitly rejects a prevalence estimate.

## What changed in the calls

| Default run | Recorded FX tool-output bytes |
| --- | ---: |
| Find available capabilities | 10,331 |
| Load the discovery tool schema | 224 |
| Discover `OpenAI AND client` as literal terms | 3,779 |
| Load the context-expansion tool schema | 234 |
| Expand the first result's context | 12,298 |
| Discover `OpenAI` with a client-sender filter | 12,423 |
| **Total** | **39,289** |

The first query searched for the word `client` instead of filtering client senders.
Its context expansion added no support for either final concern. The last discovery
call corrected the filter and supplied both cited messages.

| Guided run | Recorded FX tool-output bytes |
| --- | ---: |
| Find available capabilities | 11,101 |
| Load the discovery tool schema | 224 |
| Discover `OpenAI AND concern`, with a client-sender filter | 3,525 |
| Broaden to `OpenAI`, keeping the client-sender filter | 12,423 |
| **Total** | **27,273** |

The guided run used the sender filter immediately. When the narrower query supplied
only pricing concern support, it broadened the query and found the second concern.
It avoided loading and calling the context-expansion tool. The byte saving includes
all recorded tool outputs, even the guided run's larger capability-search response.

Neither run was optimal: the final broad discovery alone contained both concerns.
Guidance helped in this pair, but did not remove every avoidable call. The server
stayed bounded during both investigations.

## Difference from returning every matching row

Both final queries had the same exact population: **105 client messages**. An
offline comparison serialized all 105 denormalized rows with the same query,
structured/text representations, SDK metadata, and FX wrapper.

| Comparison | Tool-output bytes |
| --- | ---: |
| All 105 matching rows, offline full-row reply | 97,823 |
| Actual final discovery reply, in either run | 12,423 |
| Entire default live tool trace | 39,289 |
| Entire guided live tool trace | 27,273 |

The final discovery reply was **87.30% smaller** than the full-row reply and
contained both requested concerns. Entire tool traces used **59.84%** and **72.12%**
fewer output bytes, respectively, than that one full-row reply. The full-row payload
was not sent to a model; these comparisons establish output-size savings only.

## Measurement and saved results

| Byte boundary | Default FX | Guided FX |
| --- | ---: | ---: |
| Server core MCP-compatible retrieval results | 27,874 | 15,534 |
| Captured MCP retrieval results, including SDK metadata | 28,228 | 15,770 |
| Retrieval results in FX's output wrapper | 28,500 | 15,948 |
| FX capability search and tool-selection outputs | 10,789 | 11,325 |

All captured retrieval responses fit their individual tool caps; FX did not
truncate any tool output in either run. Output bytes count each result once. They
do not count repeated inclusion in later model requests, input arguments, prompts,
or injected tool schemas. Added prompt text is reported separately above.

Installed FX 0.0.7 did not report per-run tokens or cost in the saved `ask` or session
output. Its 24-hour usage aggregate includes unrelated runs, so per-run usage is
recorded as unavailable, not zero. Session elapsed time is the difference between
saved creation and update timestamps; the observed decrease is not a latency guarantee.

Saved evidence:

- [Default run](examples/fx-discovery-run.json)
- [Guided run and observed gains](examples/fx-guided-run.json)

Each record contains the exact prompt, answer, session ID, timestamp, call arguments,
captured MCP results, byte totals, full-row comparison method, and citation checks.
Local raw FX output and session exports remain under `artifacts/fx/`; the committed
records omit personal skill-catalog payloads but retain their byte counts and hashes.

Both runs used `FX_AUTO_UPGRADE=0 fx ask --json`, with prompts passed on stdin in
fresh sessions. Sessions were exported with `fx session --id <session-id> --json`.
See [FX ask: use in scripts](https://fx.sh/docs/using-fx/fx-ask#use-fx-ask-in-scripts)
and [FX sessions: list and inspect](https://fx.sh/docs/using-fx/sessions#list-and-inspect).
The installed version's help and observed output govern these records where the
current website describes newer output fields.
