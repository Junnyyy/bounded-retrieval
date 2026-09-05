import assert from "node:assert/strict";
import test from "node:test";

import type { MessageRecord } from "../domain/message.ts";
import { evidenceCompiler, toEvidence } from "./evidence.ts";
import { matchText, normalizeQuery } from "./query.ts";

function message(text: string): MessageRecord {
  return {
    conversationId: "synthetic-conversation",
    conversationName: "Synthetic conversation",
    conversationType: "private_channel",
    messageId: "synthetic-message",
    replyToMessageId: null,
    senderId: "synthetic-client",
    senderName: "Synthetic client",
    senderOrganization: "Synthetic organization",
    senderType: "client",
    sentAt: 0,
    text,
    threadRootMessageId: null,
    workspaceId: "synthetic-workspace",
  };
}

test("snippet extraction cannot change later eligibility or occurrence counts", () => {
  for (const mode of ["literal", "phrase", "prefix"] as const) {
    const query = normalizeQuery({
      clauses: [{ match: mode, role: "canonical", text: "OpenAI" }],
      combine: "all",
    });
    const clauses = evidenceCompiler(query);
    const texts = ["A long introductory sentence before OpenAI.", "OpenAI OpenAI", "OpenAI"];
    for (const order of [texts, texts.toReversed(), [...texts, ...texts]]) {
      for (const text of order) {
        const evidence = toEvidence(message(text), {
          clauses, corpusVersion: "synthetic-v1", maximumSnippetCharacters: 80,
          query, rank: null,
        });
        assert.ok(evidence);
        assert.ok(evidence.snippet.includes("OpenAI"));
        assert.equal(matchText(text, clauses, "all")?.[0]?.occurrences,
          text === "OpenAI OpenAI" ? 2 : 1);
      }
    }
    clauses[0]!.pattern.lastIndex = 1_000;
    assert.equal(matchText("OpenAI", clauses, "all")?.[0]?.firstOffset, 0);
  }
});

test("shared matching preserves all/any semantics and canonical/alias roles", () => {
  const query = normalizeQuery({
    clauses: [
      { match: "literal", role: "canonical", text: "OpenAI" },
      { match: "phrase", role: "alias", text: "Open AI" },
    ],
    combine: "all",
  });
  const clauses = evidenceCompiler(query);
  assert.equal(matchText("OpenAI", clauses, "all"), null);
  assert.equal(matchText("Open-AI", clauses, "any")?.[0]?.clause.role, "alias");
  const matches = matchText("OpenAI and Open AI", clauses, "all");
  assert.deepEqual(matches?.map((match) => match.clause.role).toSorted(), ["alias", "canonical"]);
});
