# Research and design reasoning

This reference asks how much retrieval work can stay outside model context without
removing the evidence needed for an answer. Its contribution is a concrete tool
contract and an evaluation of that contract on synthetic conversations.

The sections below distinguish published guidance, this implementation's choices,
and the questions its experiments leave open. Sources were revisited during this
revision. The repository uses MCP specification 2025-11-25 and SDK 2.0.0; SDK links
cover the v2 line rather than an immutable patch snapshot.

## Put aggregation where the data lives

[OpenAI's function-design guidance](https://developers.openai.com/api/docs/guides/function-calling#best-practices-for-defining-functions)
recommends moving known work into code and combining operations that are always
used together. [Anthropic's tool-design article](https://www.anthropic.com/engineering/writing-tools-for-agents#choosing-the-right-tools-for-agents)
argues for tools built around agent tasks instead of direct wrappers around every
underlying API endpoint.

For a frequency question, returning messages makes the agent perform aggregation
that the server can compute exactly. This implementation separates occurrences,
messages, threads, and conversations because each answers a different question.
Ten occurrences in one repeated message do not imply ten independent conversations.

Discovery has a different requirement. It needs text, but it also needs counts to
place that text in a matching population. Returning counts with excerpts avoids a
predictable measurement call. Requiring every investigation to measure, discover,
sample, and expand would force work even when the first excerpts answer the question.

The five-tool surface is therefore a hypothesis about useful decision boundaries.
The experiment does not compare it against a single tool with modes. An engineer
adapting it should keep operations together when they are consistently needed
together, and separate them when their evidence or disclosure requirements differ.

## Select evidence without hiding its limits

[Anthropic's response guidance](https://www.anthropic.com/engineering/writing-tools-for-agents#returning-meaningful-context-from-your-tools)
recommends returning information that helps the agent act and evaluating response
formats for the task. That leaves an important implementation question: which
information can be removed without weakening the answer?

This server removes repeated representations and limits duplicate excerpts while
retaining citations, attribution, timestamps, and clipping state. Those fields
have distinct uses. A citation supports verification, sender metadata distinguishes
client statements from internal speculation, and a clipping flag warns that the
visible fragment may omit qualifying text.

Duplicate selection compares full text before clipping. Otherwise two different
messages with the same opening could collapse into one. Repeat counts describe
the filtered population, while the displayed sender belongs only to the selected
representative. These rules prevent compression from changing attribution.

The saved comparison shows why minimum bytes is the wrong objective. Formatting
alone reduced output for the same evidence by 17–19%. Adding duplicate-aware
selection then increased broad discovery from 12,598 to 13,922 bytes while gaining
support for two planted categories. The extra bytes bought relevant evidence.
See the [implementation comparison](evaluation.md#implementation-comparison).

Ranked discovery still returns only two of five planted categories. Diversity of
text or threads is not a relevance test. Sampling adds another view of the matching
population, but our samples are over previously undisclosed messages and can be
stratified. They are not a basis for estimating theme prevalence. In the seed
checks, sampling raises coverage from zero to two or three categories after an
initial five-excerpt discovery. The standalone discovery recipe uses eight
excerpts, so comparing their final totals does not isolate the effect of sampling.
The sampling recipe still misses categories found by fixture-informed refinements.
The agent must also distinguish a mention of a subject from a statement of concern
about it.

## Bound the response before transmission

[MCP structured content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content)
and [SDK v2: Register a tool with structured output](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools)
describe structured results accompanied by compatibility text. The serializer in
this repository counts both representations. Counting just snippets would miss
attribution, query metadata, escaping, and the duplicated payload.

A row limit cannot bound output when row lengths vary. The server therefore fits
the serialized UTF-8 result to a byte cap and reports omissions after fitting.
During context expansion it preserves the anchor and thread root longest, since
removing the message being explained would defeat the request.

The 16 KiB result ceiling is a reference setting, not a measured optimum. Bytes
provide a deterministic boundary independent of a model's tokenizer, but they do
not establish token consumption, cost, or answer quality. Captured SDK metadata
and FX wrapping are separate measurement layers. An implementation must verify
what crosses its actual transport boundary rather than assuming its internal
counter includes every addition.

## Account for follow-up disclosure

[MCP pagination](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination#operations-supporting-pagination)
covers listing operations, not arbitrary tool results. Applications must define
how retrieval follow-ups work. Here, opaque query references connect follow-up
calls to normalized queries and a shared 48 KiB disclosure budget.

A result cap alone allows an agent to accumulate many bounded replies. Charging
repeated calls to the same query makes that accumulation explicit. Normalization
also prevents syntactically equivalent requests from receiving separate budgets.
Only references actually transmitted to the agent authorize expansion; aggregate
duplicate counts do not reveal every member of a group.

This boundary has limits. Different normalized queries have separate budgets, and
restarting the server ends the process-scoped accounting. The 48 KiB cap is not a
whole-investigation, conversation, or account limit. It is also not a privacy or
authorization boundary. A deployment needing those guarantees would require
additional policy and state beyond this reference.

## Define what an exact match means

[SQLite's Unicode61 tokenizer](https://www.sqlite.org/fts5.html#unicode61_tokenizer)
normalizes case and many diacritics and treats punctuation as separators.
[Prefix queries](https://www.sqlite.org/fts5.html#fts5_prefix_queries) match token
prefixes. These index rules need not match an application's definition of a literal
occurrence.

Here, FTS5 supplies candidates and original message text determines exact matches
and offsets. Literal `OpenAI` is case-insensitive and boundary-aware, but `Open AI`,
`Open-AI`, `OpenAÍ`, and `ChatGPT` require explicit alias clauses. A broader query
can be useful, but it must not silently change what a reported count means.

This makes lexical measurement reproducible. It does not solve semantic recall.
A client can express a concern without using any chosen query term. The refined
fixture recipe finds all five categories because its vocabulary fits known message
templates. New seeds change the fixture but do not introduce independent language.
An application needing semantic retrieval would have to evaluate candidate recall
and evidence selection separately while retaining the output boundary.

## Distinguish server limits from host context management

[OpenAI compaction](https://developers.openai.com/api/docs/guides/compaction#server-side-compaction)
manages accumulated conversation context.
[Anthropic programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling#how-programmatic-tool-calling-works)
lets code process intermediate tool results before the model receives the final
output. These approaches address related costs at different points in execution.

A bounded server puts the disclosure rule in one place for all its clients.
Programmatic calling can still combine or filter its results, and compaction can
still manage the conversation later. Neither must run for this server's own
result fitting to work. FX's output limit stays above the server cap so host
truncation cannot make an oversized server reply appear compliant.

There is a cost to this separation. The server cannot assume the host remembers
an earlier excerpt, so repeated replies consume budget again. Supporting cheap
repeat receipts would require an explicit retention and redisclosure contract.
This reference does not define one.

## Evaluate the answer path as well as the serializer

[Anthropic's evaluation guidance](https://www.anthropic.com/engineering/writing-tools-for-agents#running-an-evaluation)
recommends verifiable outcomes and tracking calls, errors, runtime, and usage.
For this project, correctness and evidence coverage must be checked before treating
smaller output as an improvement.

The deterministic evaluation isolates server behavior. Ground-truth labels remain
outside retrieval, and clipped labeled messages do not count as visible category
support. The former fixed discovery/sample/expansion trace retrieves no planted
support despite a small response total. That failure is retained in the report.

The live experiment tests another layer. The default agent searched for the word
`client` instead of applying a sender filter, then expanded context that did not
support its answer. Added guidance avoided those choices in one paired example.
However, both runs asked for only two concerns and both made avoidable calls.
They do not establish broad discovery quality or a general benefit from guidance.

A [broader live test](evaluation.md#broader-live-investigation) asked for distinct
concerns without supplying a category count. Five retrieval calls produced two
supported topics, but only one planted category. The agent searched for the word
`client`, left sender filters empty, and sampled the same narrow population. The
server could apply that query exactly without making it appropriate for the task.

This also exposes a limit in the evaluator. Vendor approval was a supported topic
outside the five planted labels. Category coverage measures recall of those labels;
it does not establish that every unlabelled answer is wrong. Citation validity and
planted-category coverage need separate checks.

A useful follow-up would compare explicit sender-filter and clause-role guidance
against default instructions on the same model and prompt. Repeated sessions and
independently authored wording are still needed before claiming reliable agent
improvements. See the [evaluation report](evaluation.md) for current evidence and
reproducible checks.

## How much evidence is enough for the next decision?

The experiments establish behavior at chosen limits. They do not establish an
optimal response size, number of excerpts, or arrangement of tools. Eight excerpts
can answer a request for two examples and still fail a broader investigation.
The required evidence depends on what the agent must decide.

For an exact frequency question, completed counts may be sufficient. For a claim
about a particular concern, a fully visible statement with attribution may support
the claim. For coverage across clients or time periods, one ranked selection may
leave gaps. The [annotated response](discovery-results.md#reading-a-discovery-result)
shows which retained fields expose those differences.

A useful experiment would vary result budgets and selection limits while keeping
the corpus, task, model, and instructions fixed. It should measure cited support,
missing evidence, total calls, and full-run usage when available. A smaller reply
might cause more follow-up calls; a larger one might add no useful support. The
question is whether the response enables the required decision at lower total
cost. This reference has not yet measured that relationship across response sizes.
