# Response reference

This document defines how to interpret bounded retrieval results. See the
[evaluation report](evaluation.md) for measured comparisons and the
[schemas](../src/mcp/schemas.ts) for exact field definitions.

## Response contract, version 2

Each tool has a strict output schema. Successful results share an envelope with
corpus and query references, byte limits, disclosure counters, scan outcome,
omissions, and truncation state. Structured content and its compatibility text
copy both count toward the response budget.

| Field | Meaning |
| --- | --- |
| `outcome` | Whether the required scan completed. It does not indicate task success. |
| `selection.exhaustive` | Whether all eligible messages were returned. It does not establish semantic completeness or unclipped text. |
| `stop_reasons` | All applicable item, execution, byte, window, or text limits. Multiple reasons may coexist. |
| `same_text_matches` | Exact message/sender/conversation/thread multiplicities for the representative's full text within the filtered query, or null when unknown. |
| Sample `population` | Previously undisclosed eligible messages and strata. Counts are null for incomplete scans. |
| `returned_strata` | Strata represented in the transmitted sample, after byte fitting. |
| `next_actions` | Guidance when incomplete scans or clipped evidence justify another action. Empty does not mean the question is answered. |

`omitted` counts messages for discovery and context, eligible undisclosed messages
for a complete sample, and time buckets for measurement. It is null when unknown
or inapplicable. Aggregate repeat counts do not reduce omitted message counts;
those messages were counted, not individually disclosed.

## Reading a discovery result

The final discovery call in the [guided FX record](examples/fx-guided-run.json)
searched client-authored messages containing `OpenAI`. The table below selects
fields from that actual result; it is an annotation, not a complete response.

| Information retained | Observed value | What it helps the agent decide |
| --- | --- | --- |
| Matching population | 105 messages; 118 occurrences; 10 conversations | How much data the lexical query covers. These are not concern-frequency estimates. |
| Excerpt and attribution | Harper Tran, client at Atlas Works: "Our main OpenAI concern is pricing predictability as usage grows." | Whether a client statement supports the proposed pricing theme. |
| Timestamp | January 5, 2026, 14:00 UTC | Whether this evidence is relevant to the requested period. |
| Stable reference | `corpus://corpus-5e230f570d08e494/messages/message-000000001` | Which source to cite or use as an expansion anchor. |
| Text clipping | `snippet_clipped: false` | The selected message text is fully visible. This says nothing about other messages. |
| Selection and omissions | 8 excerpts returned; 97 messages omitted; `stop_reasons: [item_limit]` | Whether the returned evidence exhausts the matching population. It does not. |
| Remaining query budget | 36,936 bytes | How much further disclosure this query allows. Remaining capacity does not justify another call by itself. |

Here, `outcome: complete` and `truncated: true` coexist. The server completed the
scan, but the item limit reduced the transmitted selection. Neither state cancels
the other. The agent can cite the visible pricing statement while acknowledging
that it has not inspected every matching message.

This is why the response retains more than excerpts. Removing population and
omission information makes partial evidence easier to mistake for a complete
answer. Removing attribution or references makes the answer harder to verify.
Another call is useful when it resolves a specific evidence gap, such as ambiguous
wording or a missing time period, rather than merely using the available budget.

## Evidence and selection

Discovery and sampling retain message/thread references, sender and conversation
attribution, timestamps, lexical match roles, snippets, and per-item clipping.
Exact lexical matches and explicit aliases retain separate provenance. FTS5 finds
candidates; original text determines matches and occurrence counts.

Discovery selects at most one representative per exact full text and thread.
Duplicate groups compare full text before clipping. Counts cover the filtered
query population and are null if measurement is incomplete. A representative's
sender does not identify every sender in its group. Selection and measurement
share execution limits, and examined-row counts include both passes.

Sampling selects previously undisclosed messages using seeded priorities, either
uniformly or across time/conversation strata. Stratum order is also seeded.
Same-thread messages remain eligible because the sampled unit is a message.
Sampling is not pagination and does not estimate theme prevalence.

Context fitting preserves the anchor and thread root longest, removes distant
neighbors first, and reports final clipping and omissions. A one-message request
returns only the anchor.

## References and disclosure

Evidence references are stable for a corpus version. Query references are opaque
and process-scoped. Equivalent normalized queries share one reference and a
48 KiB budget for the process's lifetime, including equivalent single-clause
`all` and `any` requests.

Only transmitted message references authorize expansion. Duplicate-group
membership, aggregate counts, and rows removed during fitting do not grant access.
Repeated calls consume the shared budget because the server cannot assume the
host still retains earlier results.

Requested limits can be lower than the tool caps, never higher. Incomplete scans,
clipped selections, and rejected requests must remain explicit. A small result
must not be interpreted as exhaustive solely because it fits the budget.
