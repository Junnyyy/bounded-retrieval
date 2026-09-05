import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateCorpus, type GenerateCorpusResult } from "../corpus/generate.ts";
import type { CorpusProfile } from "../corpus/profiles.ts";
import { openCorpusDatabase } from "../database/corpus.ts";
import { expandMessageContext } from "./context.ts";
import { discoverMessages } from "./discover.ts";
import { sampleMessages } from "./sample.ts";
import { withTestCorpus } from "../testing/corpus.ts";

const PROFILE: CorpusProfile = {
  days: 7,
  description: "selection test fixture",
  messageCount: 5_000,
  name: "week",
  participantCount: 20,
  realistic: true,
};

const OPENAI_QUERY = {
  clauses: [{ match: "literal", role: "canonical", text: "OpenAI" }],
  combine: "any",
} as const;

function withCorpus(
  run: (
    database: ReturnType<typeof openCorpusDatabase>,
    generated: GenerateCorpusResult,
  ) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), "bounded-retrieval-select-"));
  const path = join(directory, "fixture.sqlite");
  try {
    const generated = generateCorpus({
      databasePath: path,
      profile: PROFILE,
      seed: "selection-seed",
    });
    const database = openCorpusDatabase(path, { readOnly: true });
    try {
      run(database, generated);
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
}

test("discovers bounded thread-diverse evidence with stable references", () => {
  withCorpus((database, generated) => {
    const result = discoverMessages(database, OPENAI_QUERY, { limit: 8 });
    assert.equal(result.evidence.length, 8);
    assert.equal(new Set(result.evidence.map((item) => item.threadRef)).size, 8);
    assert.ok(result.evidence.every((item) => item.snippet.length <= 320));
    assert.ok(
      result.evidence.every((item) =>
        item.messageRef.startsWith(`corpus://${generated.metadata.version}/messages/`),
      ),
    );
    assert.equal(result.shape.outcome, "complete");
  });
});

test("samples deterministically and excludes disclosed messages", () => {
  withCorpus((database) => {
    const first = sampleMessages(database, OPENAI_QUERY, {
      limit: 8,
      seed: "sample-seed",
      strategy: "across_time",
    });
    const repeat = sampleMessages(database, OPENAI_QUERY, {
      limit: 8,
      seed: "sample-seed",
      strategy: "across_time",
    });
    assert.deepEqual(
      first.evidence.map((item) => item.messageId),
      repeat.evidence.map((item) => item.messageId),
    );

    const next = sampleMessages(database, OPENAI_QUERY, {
      excludeMessageIds: new Set(first.evidence.map((item) => item.messageId)),
      limit: 8,
      seed: "sample-seed",
      strategy: "across_time",
    });
    assert.equal(
      next.evidence.some((item) =>
        first.evidence.some((prior) => prior.messageId === item.messageId),
      ),
      false,
    );
  });
});

test("seeded sampling reaches the whole population rather than the first strata", () => {
  withCorpus((database) => {
    for (const strategy of ["uniform", "across_time", "across_conversations"] as const) {
      const days = new Set<string>();
      const conversations = new Set<string>();
      for (let seed = 0; seed < 32; seed += 1) {
        const result = sampleMessages(database, OPENAI_QUERY, {
          limit: 2, seed: `coverage-${seed}`, strategy,
        });
        assert.equal(result.outcome, "complete");
        assert.equal(result.evidence.length, 2);
        for (const item of result.evidence) {
          days.add(item.sentAt.slice(0, 10));
          conversations.add(item.conversation.id);
        }
      }
      assert.ok(days.size >= 6, `${strategy} covered only ${days.size} dates`);
      assert.ok(conversations.size >= 8, `${strategy} covered only ${conversations.size} conversations`);
    }
  });
});

test("sampling reports incomplete work when a candidate limit interrupts the scan", () => {
  withCorpus((database) => {
    const result = sampleMessages(database, OPENAI_QUERY, {
      executionLimits: { maxCandidateRows: 1, maxMilliseconds: 5_000 },
      limit: 8, seed: "interrupted", strategy: "uniform",
    });
    assert.equal(result.outcome, "incomplete");
  });
});

test("expands threaded and unthreaded messages within the hard item cap", () => {
  withCorpus((database) => {
    const threaded = database
      .prepare(
        "SELECT message_id FROM messages WHERE thread_root_message_id IS NOT NULL LIMIT 1",
      )
      .get() as { message_id: string };
    const unthreaded = database
      .prepare(`
        SELECT candidate.message_id
        FROM messages AS candidate
        WHERE candidate.thread_root_message_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM messages AS reply
            WHERE reply.thread_root_message_id = candidate.message_id
          )
        LIMIT 1
      `)
      .get() as { message_id: string };

    const threadContext = expandMessageContext(database, threaded.message_id, 20);
    assert.equal(threadContext.contextKind, "thread");
    assert.ok(threadContext.messages.length <= 20);
    assert.ok(
      threadContext.messages.some(
        (message) => message.messageId === threaded.message_id,
      ),
    );
    const anchorOnly = expandMessageContext(database, threaded.message_id, 1);
    assert.equal(anchorOnly.messages.length, 1);
    assert.equal(anchorOnly.messages[0]?.messageId, threaded.message_id);
    assert.ok(anchorOnly.totalMessages >= 2);
    assert.equal(anchorOnly.clippedBefore, true);

    const conversationContext = expandMessageContext(
      database,
      unthreaded.message_id,
      5,
    );
    assert.equal(conversationContext.contextKind, "conversation");
    assert.ok(conversationContext.messages.length <= 5);
    assert.deepEqual(
      conversationContext.messages.map((message) => message.sentAt),
      conversationContext.messages
        .map((message) => message.sentAt)
        .toSorted(),
    );
  });
});

test("discovery groups full text and counts all sources, including earlier skipped representatives", () => {
  withTestCorpus([
    { messageId: "root", text: "OpenAI OpenAI" },
    { text: "OpenAI needs a much longer explanatory statement", threadRootMessageId: "root", replyToMessageId: "root" },
    { text: "OpenAI needs a much longer explanatory statement" },
  ], (database) => {
    const result = discoverMessages(database, OPENAI_QUERY);
    assert.equal(result.evidence.length, 2);
    const group = result.evidence.find((item) => item.snippet.includes("explanatory"));
    assert.equal(group?.messageId, "message-2");
    assert.deepEqual(group.sameTextMatches, { messages: 2, senders: 2, conversations: 2, threads: 2 });
  });
});

test("distinct full messages remain distinct when their clipped excerpts coincide", () => {
  const prefix = `OpenAI ${"😀".repeat(250)}`;
  withTestCorpus([{ text: `${prefix} first ending` }, { text: `${prefix} different ending` }], (database) => {
    const result = discoverMessages(database, OPENAI_QUERY);
    assert.equal(result.evidence.length, 2);
    assert.equal(result.evidence[0]?.snippet, result.evidence[1]?.snippet);
    assert.ok(result.evidence.every((item) => item.snippetClipped && item.sameTextMatches?.messages === 1));
  });
});

test("a repeated dominant statement cannot hide a distinct late-period concern", () => {
  withTestCorpus([
    ...Array.from({ length: 50 }, () => ({ text: "OpenAI mentioned in review" })),
    { text: "OpenAI outages would prevent us from serving customers." },
  ], (database) => {
    const result = discoverMessages(database, OPENAI_QUERY);
    assert.equal(result.evidence.length, 2);
    assert.ok(result.evidence.some((item) => item.messageId === "message-50"));
    assert.equal(result.shape.outcome, "complete");
  });
});

test("interrupted group measurement never exposes partial multiplicities as exact", () => {
  withTestCorpus(Array.from({ length: 20 }, () => ({ text: "OpenAI repeated evidence" })), (database) => {
    const result = discoverMessages(database, OPENAI_QUERY, {
      limit: 1, executionLimits: { maxCandidateRows: 3, maxMilliseconds: 5_000 },
    });
    assert.equal(result.shape.outcome, "incomplete");
    assert.equal(result.evidence[0]?.sameTextMatches, null);
  });
});

test("uniform sampling can return multiple messages from one thread", () => {
  withTestCorpus([
    { messageId: "root" },
    ...Array.from({ length: 9 }, () => ({ threadRootMessageId: "root", replyToMessageId: "root" })),
  ], (database) => {
    const sample = sampleMessages(database, OPENAI_QUERY, { limit: 8, seed: "same-thread", strategy: "uniform" });
    assert.equal(sample.evidence.length, 8);
    assert.equal(sample.populationMessages, 10);
  });
});
