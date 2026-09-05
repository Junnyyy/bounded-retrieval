# Research notes

This document records public behavior that informed the reference design. It distinguishes sourced facts from project-specific conclusions. The snapshot date is 2026-09-02.

## Bounded tools are a service responsibility

### Public evidence

- OpenAI recommends small, intuitive tool surfaces, strict schemas, and combining operations that are always used together. Tool search is intended for substantially larger catalogs than this project's five operations. See [Function calling: best practices](https://developers.openai.com/api/docs/guides/function-calling#best-practices-for-defining-functions), [Function calling: strict mode](https://developers.openai.com/api/docs/guides/function-calling#strict-mode), and [Tool search](https://developers.openai.com/api/docs/guides/tools-tool-search#tool-search).
- OpenAI compaction may prune prior context into an opaque item. It is conversation management rather than an exact retrieval ledger. See [Compaction: server-side compaction](https://developers.openai.com/api/docs/guides/compaction#server-side-compaction).
- Anthropic programmatic tool calling can filter large intermediate results before they reach model context, while its context-editing and compaction features can remove or summarize older tool results. These are provider features, not portable MCP guarantees. See [Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling#how-programmatic-tool-calling-works), [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing#tool-result-clearing), and [Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction#how-compaction-works).
- GitHub Copilot CLI writes tool outputs larger than 20 KiB to a temporary file and gives the model a preview and path. VS Code similarly narrows tools and deterministically reduces some terminal output. See [GitHub Copilot CLI: managing large tool output](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/context-management#managing-large-tool-output) and [VS Code tools: why limit available tools](https://code.visualstudio.com/docs/agents/concepts/tools#why-limit-the-available-tools).

### Project conclusion

The MCP server must bound its own result before any host sees it. Host compaction, result spilling, tool search, and context editing are useful later defenses but cannot establish the project's invariant.

## Purpose-specific discovery operations

### Public evidence

- Anthropic recommends returning high-signal data with stable identifiers and consolidating related operations to reduce tool-selection ambiguity. See [Tool definition best practices](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools#best-practices-for-tool-definitions) (rechecked 2026-09-04). Choosing five separate contracts below is this project's design decision, not a requirement from that guidance.
- MCP does not define pagination for arbitrary `tools/call` results. Application-level opaque handles are therefore appropriate for progressive disclosure. See [MCP pagination: supported operations](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination#operations-supporting-pagination).
- MCP tools can return schema-validated `structuredContent` and resource links. A text representation improves compatibility. See [MCP tools: structured content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content) and [MCP tools: resource links](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#resource-links).

### Project conclusion

Measurement, ranked discovery, representative sampling, context expansion, and exhaustive export have different epistemic and safety contracts. They remain five explicit tools. Sampling is not disguised pagination, and exports return handles rather than rows.

## FTS5 is candidate retrieval, not raw-text truth

### Public evidence

- FTS5's default `unicode61` tokenizer is case-insensitive, removes many Latin diacritics, and treats punctuation as separators. See [FTS5: Unicode61 tokenizer](https://www.sqlite.org/fts5.html#unicode61_tokenizer).
- Prefix matching is token-prefix matching rather than general substring matching. See [FTS5: prefix queries](https://www.sqlite.org/fts5.html#fts5_prefix_queries).
- `MATCH` identifies matching rows. FTS5 vocabulary tables distinguish documents containing a term from indexed term instances. See [FTS5 vocabulary tables](https://www.sqlite.org/fts5.html#the_fts5vocab_virtual_table_module).
- `snippet()` selects a short presentation fragment and is not an exhaustive occurrence surface. See [FTS5: snippet function](https://www.sqlite.org/fts5.html#the_snippet_function).

### Project conclusion

FTS5 finds candidates. Deterministic inspection of original message text defines exact OpenAI occurrences and offsets. Occurrence, message, thread, and conversation counts remain separate metrics.

## FX is a replaceable harness

### Public evidence

- FX supports project-local MCP servers through `.mcp.json`, subject to explicit project trust. See [FX MCP: project configuration and trust](https://fx.sh/docs/capabilities/mcp#project-configuration-and-trust).
- FX compacts older session turns but retains the saved transcript. See [FX sessions: compact long sessions](https://fx.sh/docs/using-fx/sessions#compact-long-sessions).
- The embedded Node SDK deliberately lacks native MCP and tool access. See [FX Node SDK: embedded agent capabilities](https://fx.sh/docs/lib/node#what-the-embedded-agent-can-do).

### Project conclusion

Use native FX 0.0.7 as the chat UI and MCP client. Keep all durable retrieval behavior in the local server. The repository runner verifies the external FX version and disables automatic upgrades; it does not download FX.

## Version choices

- Node 24.20.0 includes SQLite 3.53.4. Official Node builds enable FTS5. See [Node 24.20.0 release](https://nodejs.org/en/blog/release/v24.20.0) and [Node SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html#sqlite).
- The modular MCP v2 server package supports schema-validated tool registration, structured results, resource links, and stdio serving. See [MCP TypeScript SDK: tools](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html#add-a-tool) and [MCP TypeScript SDK: stdio](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html#serve-a-factory-over-stdio).
- pnpm 11 supports Node 24. See [pnpm installation: compatibility](https://pnpm.io/installation#compatibility).

The repository pins Node 24.20.0, pnpm 11.18.0, FX 0.0.7, `@modelcontextprotocol/server` 2.0.0, Zod 4.5.4, TypeScript 7.0.2, and `@types/node` 24.13.3.
