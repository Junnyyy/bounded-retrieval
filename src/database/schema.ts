import type { DatabaseSync } from "node:sqlite";

export function createCorpusSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;

    CREATE TABLE corpus_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    CREATE TABLE messages (
      message_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      conversation_name TEXT NOT NULL,
      conversation_type TEXT NOT NULL CHECK (
        conversation_type IN (
          'public_channel',
          'private_channel',
          'direct_message',
          'group_direct_message'
        )
      ),
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('internal', 'client')),
      sender_organization TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      text TEXT NOT NULL,
      thread_root_message_id TEXT,
      reply_to_message_id TEXT
    ) STRICT;

    CREATE INDEX messages_sent_at_idx
      ON messages(sent_at, message_id);
    CREATE INDEX messages_sender_idx
      ON messages(sender_type, sender_id, sent_at);
    CREATE INDEX messages_conversation_idx
      ON messages(conversation_id, sent_at, message_id);
    CREATE INDEX messages_thread_idx
      ON messages(thread_root_message_id, sent_at, message_id);
  `);
}

export function buildFullTextIndex(database: DatabaseSync): void {
  database.exec(`
    CREATE VIRTUAL TABLE messages_fts USING fts5(
      text,
      content='messages',
      content_rowid='rowid',
      tokenize='unicode61'
    );

    INSERT INTO messages_fts(messages_fts) VALUES('rebuild');
  `);
}
