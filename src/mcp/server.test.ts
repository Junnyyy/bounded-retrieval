import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";

import { generateCorpus } from "../corpus/generate.ts";

interface JsonRpcResponse {
  readonly error?: { readonly message: string };
  readonly id: number;
  readonly result?: unknown;
}

function createClient(child: ChildProcessWithoutNullStreams) {
  let nextId = 1;
  const pending = new Map<
    number,
    { reject: (error: Error) => void; resolve: (value: unknown) => void }
  >();
  const lines = createInterface({ input: child.stdout });

  lines.on("line", (line) => {
    const response = JSON.parse(line) as JsonRpcResponse;
    const request = pending.get(response.id);
    if (request === undefined) return;
    pending.delete(response.id);
    if (response.error !== undefined) {
      request.reject(new Error(response.error.message));
    } else {
      request.resolve(response.result);
    }
  });

  return {
    notify(method: string): void {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
    },
    request(method: string, params: Record<string, unknown>): Promise<unknown> {
      const id = nextId++;
      const result = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { reject, resolve });
      });
      child.stdin.write(`${JSON.stringify({ id, jsonrpc: "2.0", method, params })}\n`);
      return Promise.race([
        result,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 5_000).unref();
        }),
      ]);
    },
  };
}

test("serves all bounded tools over MCP stdio", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "bounded-retrieval-mcp-"));
  const databasePath = join(directory, "fixture.sqlite");
  const exportDirectory = join(directory, "exports");
  generateCorpus({
    databasePath,
    profile: {
      days: 7,
      description: "MCP smoke fixture",
      messageCount: 500,
      name: "week",
      participantCount: 20,
      realistic: true,
    },
    seed: "mcp-smoke-seed",
  });

  const child = spawn(process.execPath, ["src/mcp/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BOUNDED_RETRIEVAL_DB: databasePath,
      BOUNDED_RETRIEVAL_EXPORT_DIR: exportDirectory,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  context.after(() => {
    if (!child.killed) child.kill();
    rmSync(directory, { force: true, recursive: true });
  });
  const client = createClient(child);

  await client.request("initialize", {
    capabilities: {},
    clientInfo: { name: "bounded-retrieval-test", version: "0.0.0" },
    protocolVersion: "2025-11-25",
  });
  client.notify("notifications/initialized");

  const listResult = (await client.request("tools/list", {})) as {
    readonly tools: readonly { readonly name: string }[];
  };
  assert.deepEqual(
    listResult.tools.map((tool) => tool.name),
    [
      "measure_messages",
      "discover_messages",
      "sample_messages",
      "expand_message_context",
      "export_messages",
    ],
  );

  const callResult = (await client.request("tools/call", {
    arguments: {
      query: {
        clauses: [{ match: "literal", role: "canonical", text: "OpenAI" }],
        combine: "all",
      },
    },
    name: "measure_messages",
  })) as {
    readonly content: readonly { readonly text: string; readonly type: string }[];
    readonly structuredContent: { readonly result_kind: string; readonly query_ref: string; readonly schema_version: string };
  };
  assert.equal(callResult.content[0]?.type, "text");
  assert.equal(callResult.structuredContent.result_kind, "measurement");
  assert.ok(Buffer.byteLength(callResult.content[0]?.text ?? "") > 0);
  assert.equal(callResult.structuredContent.schema_version, "2");

  const query = { clauses: [{ match: "literal", role: "canonical", text: "OpenAI" }], combine: "all" };
  async function call(name: string, args: Record<string, unknown>) {
    const response = await client.request("tools/call", { name, arguments: args }) as {
      isError?: boolean;
      content: { type: string; text: string }[];
      structuredContent: {
        disclosure: { response_bytes: number };
        result: { evidence?: { message_ref: string }[] };
      };
    };
    assert.notEqual(response.isError, true, JSON.stringify(response));
    assert.deepEqual(JSON.parse(response.content[0]!.text), response.structuredContent);
    assert.equal(Buffer.byteLength(JSON.stringify(response), "utf8"), response.structuredContent.disclosure.response_bytes);
    assert.ok(response.structuredContent.disclosure.response_bytes <= 16 * 1_024);
    return response;
  }
  const discovered = await call("discover_messages", { query, limit: 2 });
  const queryRef = callResult.structuredContent.query_ref;
  await call("sample_messages", { query_ref: queryRef, strategy: "uniform", limit: 2 });
  await call("expand_message_context", { query_ref: queryRef, message_ref: discovered.structuredContent.result.evidence![0]!.message_ref, limit: 1 });
  await call("export_messages", { query_ref: queryRef });
});
