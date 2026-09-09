# Design sources

These sources informed the design. They explain relevant tool and retrieval
behavior; the [evaluation](evaluation.md) tests this implementation's choices.
The original research snapshot was September 2, 2026, with Anthropic's tool
guidance rechecked September 4, 2026.

## Tool boundaries

[OpenAI: Function calling best practices](https://developers.openai.com/api/docs/guides/function-calling#best-practices-for-defining-functions)
recommends intuitive functions and moving known work into code.
[Anthropic: Tool definition best practices](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools#best-practices-for-tool-definitions)
favors useful responses with stable identifiers.

This reference separates counting, discovery, sampling, context, and export because
they return different kinds of information. Discovery includes counts to avoid a
predictable extra call. Five tools is a project choice, not a requirement from
these sources.

## Output and follow-up calls

[MCP: Structured content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content)
recommends a compatibility text representation alongside structured output.
[SDK v2: Register a tool with structured output](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools)
shows both representations. This server counts both against its output budget.
The repository pins SDK 2.0.0; the documentation covers the v2 line.

[MCP: Pagination supported operations](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination#operations-supporting-pagination)
does not define pagination for arbitrary tool results. This implementation uses
process-scoped query references to connect follow-up calls and disclosure budgets.

## Exact matching

[SQLite: Unicode61 tokenizer](https://www.sqlite.org/fts5.html#unicode61_tokenizer)
describes case and diacritic normalization and separator handling.
[Prefix queries](https://www.sqlite.org/fts5.html#fts5_prefix_queries) operate on token
prefixes, and [snippet()](https://www.sqlite.org/fts5.html#the_snippet_function)
selects presentation fragments.

FTS5 therefore supplies candidates here. Inspection of original text determines
exact occurrences and offsets. `Open AI`, `Open-AI`, `OpenAÍ`, and `ChatGPT` do not
silently count as literal `OpenAI` matches; aliases require explicit clauses.

## Host context management

[OpenAI: Server-side compaction](https://developers.openai.com/api/docs/guides/compaction#server-side-compaction)
and [Anthropic: Tool result clearing](https://platform.claude.com/docs/en/build-with-claude/context-editing#tool-result-clearing)
describe ways to manage accumulated context. They do not establish this server's
per-result disclosure limit.

The server enforces its own limits before returning output to any host. FX is the
replaceable client used for the recorded demo. Its
[project MCP support](https://fx.sh/docs/capabilities/mcp#project-configuration-and-trust)
connects it to the local server; the retrieval layer owns the budgets.
