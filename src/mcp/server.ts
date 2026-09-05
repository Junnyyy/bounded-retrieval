import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import type { StructuredQuery } from "../retrieval/query.ts";
import { BoundedRetrievalService } from "../service/bounded-retrieval-service.ts";
import type { EncodedResult } from "../service/result-envelope.ts";
import {
  discoverInputSchema,
  discoverOutputSchema,
  expandContextInputSchema,
  expandContextOutputSchema,
  exportInputSchema,
  exportOutputSchema,
  measureInputSchema,
  measureOutputSchema,
  sampleInputSchema,
  sampleOutputSchema,
  type StructuredQueryInput,
} from "./schemas.ts";

const SERVER_VERSION = "0.0.0";
const DEFAULT_DATABASE_PATH = resolve("artifacts", "corpora", "week.sqlite");
const DEFAULT_EXPORT_DIRECTORY = resolve("artifacts", "exports");

function toStructuredQuery(input: StructuredQueryInput): StructuredQuery {
  return {
    clauses: input.clauses,
    combine: input.combine,
    ...(input.filters === undefined
      ? {}
      : {
          filters: {
            ...(input.filters.conversation_ids === undefined
              ? {}
              : { conversationIds: input.filters.conversation_ids }),
            ...(input.filters.conversation_types === undefined
              ? {}
              : { conversationTypes: input.filters.conversation_types }),
            ...(input.filters.from_inclusive === undefined
              ? {}
              : { fromInclusive: input.filters.from_inclusive }),
            ...(input.filters.sender_ids === undefined
              ? {}
              : { senderIds: input.filters.sender_ids }),
            ...(input.filters.sender_types === undefined
              ? {}
              : { senderTypes: input.filters.sender_types }),
            ...(input.filters.thread_ids === undefined
              ? {}
              : { threadIds: input.filters.thread_ids }),
            ...(input.filters.to_exclusive === undefined
              ? {}
              : { toExclusive: input.filters.to_exclusive }),
          },
        }),
  };
}

function successfulResult(result: EncodedResult<Record<string, unknown>>) {
  return {
    content: result.mcpResult.content.map((block) => ({ ...block })),
    structuredContent: result.envelope,
  };
}

function errorResult(error: unknown) {
  const message =
    error instanceof Error ? error.message.slice(0, 1_000) : "Unknown tool error";
  return {
    content: [
      {
        text: message,
        type: "text" as const,
      },
    ],
    isError: true,
  };
}

function safely<Result extends EncodedResult<Record<string, unknown>>>(
  operation: () => Result,
) {
  try {
    return successfulResult(operation());
  } catch (error) {
    return errorResult(error);
  }
}

export function createBoundedRetrievalServer(options: {
  readonly artifactDirectory: string;
  readonly databasePath: string;
}): McpServer {
  const service = new BoundedRetrievalService(
    options.databasePath,
    options.artifactDirectory,
  );
  const server = new McpServer({
    name: "bounded-retrieval",
    version: SERVER_VERSION,
  });

  server.registerTool(
    "measure_messages",
    {
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        "Measure exact lexical occurrences, matching messages, threads, conversations, provenance, and time distribution without returning message text. Use when the user asks how often, how many, or where matches are concentrated. Do not use for qualitative evidence.",
      inputSchema: measureInputSchema,
      outputSchema: measureOutputSchema,
      title: "Measure messages",
    },
    async ({ query }) => safely(() => service.measureMessages(toStructuredQuery(query))),
  );

  server.registerTool(
    "discover_messages",
    {
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        "Discover ranked lexical evidence, diversified by exact full text and thread. Returns counts, time distribution, citations, and query_ref. same_text_matches counts identical text across the exact query population; the cited sender is one representative. Lexical rank and text diversity do not establish theme coverage. Refine terms or sample when the evidence does not address the question.",
      inputSchema: discoverInputSchema,
      outputSchema: discoverOutputSchema,
      title: "Discover messages",
    },
    async ({ query, limit }) =>
      safely(() => service.discoverMessages(toStructuredQuery(query), limit)),
  );

  server.registerTool(
    "sample_messages",
    {
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        "Sample previously undisclosed messages from a query_ref. Uniform gives seeded message selection; across_time and across_conversations balance seeded strata. Results state the eligible population and covered strata. Use to investigate ranked-evidence bias, not as pagination. A small sample does not establish theme frequencies or completeness.",
      inputSchema: sampleInputSchema,
      outputSchema: sampleOutputSchema,
      title: "Sample messages",
    },
    async ({ limit, query_ref, seed, strategy }) =>
      safely(() =>
        service.sampleMessages(
          query_ref,
          strategy,
          seed ?? "bounded-retrieval-sample-v1",
          limit,
        ),
      ),
  );

  server.registerTool(
    "expand_message_context",
    {
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        "Expand one message_ref already disclosed by the same query_ref into bounded chronological context. Returns a Slack thread when one exists, otherwise a surrounding channel or direct-message window. Use only after discovery or sampling identifies an anchor.",
      inputSchema: expandContextInputSchema,
      outputSchema: expandContextOutputSchema,
      title: "Expand message context",
    },
    async ({ limit, message_ref, query_ref }) =>
      safely(() =>
        service.expandMessageContext(query_ref, message_ref, limit),
      ),
  );

  server.registerTool(
    "export_messages",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description:
        "Materialize every exact match for an existing query_ref as a local JSONL artifact. Returns only artifact metadata, never message rows. Use only when the user genuinely requests exhaustive output outside model context.",
      inputSchema: exportInputSchema,
      outputSchema: exportOutputSchema,
      title: "Export messages",
    },
    async ({ query_ref }) => safely(() => service.exportMessages(query_ref)),
  );

  process.once("exit", () => service.close());
  return server;
}

async function main(): Promise<void> {
  const databasePath = resolve(
    process.env.BOUNDED_RETRIEVAL_DB ?? DEFAULT_DATABASE_PATH,
  );
  const artifactDirectory = resolve(
    process.env.BOUNDED_RETRIEVAL_EXPORT_DIR ?? DEFAULT_EXPORT_DIRECTORY,
  );
  if (!existsSync(databasePath)) {
    throw new Error(
      `Corpus database not found at ${databasePath}. Run pnpm seed -- --profile week first.`,
    );
  }

  console.error(
    `bounded-retrieval MCP server using ${databasePath} over stdio`,
  );
  await serveStdio(() =>
    createBoundedRetrievalServer({ artifactDirectory, databasePath }),
  );
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(entryPath)).href
) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
