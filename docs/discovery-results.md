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
