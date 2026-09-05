import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openCorpusDatabase } from "../database/corpus.ts";
import { buildFullTextIndex, createCorpusSchema } from "../database/schema.ts";
import type { MessageRecord } from "../domain/message.ts";

// Small, explicitly synthetic edge fixtures. Imported by tests only.
export function withTestCorpus(
  overrides: readonly Partial<MessageRecord>[],
  run: (database: ReturnType<typeof openCorpusDatabase>, databasePath: string) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), "bounded-edge-"));
  const databasePath = join(directory, "fixture.sqlite");
  const database = openCorpusDatabase(databasePath);
  try {
    createCorpusSchema(database);
    const version = `synthetic-${createHash("sha256").update(JSON.stringify(overrides)).digest("hex").slice(0, 16)}`;
    for (const [key, value] of Object.entries({
      generated_at: "2026-01-01T00:00:00.000Z", message_count: String(overrides.length),
      profile: "synthetic-edge", realistic: "false", seed: "synthetic-edge", version,
    })) database.prepare("INSERT INTO corpus_metadata VALUES (?, ?)").run(key, value);
    const insert = database.prepare(`INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [index, override] of overrides.entries()) {
      const item: MessageRecord = {
        messageId: `message-${index}`, workspaceId: "synthetic-workspace",
        conversationId: `conversation-${index}`, conversationName: "Synthetic conversation",
        conversationType: "private_channel", senderId: `sender-${index}`,
        senderName: "Synthetic client", senderType: "client", senderOrganization: "Synthetic organization",
        sentAt: Date.UTC(2026, 0, 1) + index * 86_400_000,
        text: "OpenAI synthetic evidence", threadRootMessageId: null, replyToMessageId: null,
        ...override,
      };
      insert.run(item.messageId, item.workspaceId, item.conversationId, item.conversationName,
        item.conversationType, item.senderId, item.senderName, item.senderType, item.senderOrganization,
        item.sentAt, item.text, item.threadRootMessageId, item.replyToMessageId);
    }
    buildFullTextIndex(database);
    run(database, databasePath);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
