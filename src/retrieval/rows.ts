import type { MessageRecord } from "../domain/message.ts";

export interface MessageRow {
  readonly conversation_id: string;
  readonly conversation_name: string;
  readonly conversation_type: MessageRecord["conversationType"];
  readonly message_id: string;
  readonly rank?: number;
  readonly reply_to_message_id: string | null;
  readonly sender_id: string;
  readonly sender_name: string;
  readonly sender_organization: string;
  readonly sender_type: MessageRecord["senderType"];
  readonly sent_at: number;
  readonly text: string;
  readonly thread_root_message_id: string | null;
  readonly workspace_id: string;
}

export function rowToMessage(row: MessageRow): MessageRecord {
  return {
    conversationId: row.conversation_id,
    conversationName: row.conversation_name,
    conversationType: row.conversation_type,
    messageId: row.message_id,
    replyToMessageId: row.reply_to_message_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderOrganization: row.sender_organization,
    senderType: row.sender_type,
    sentAt: row.sent_at,
    text: row.text,
    threadRootMessageId: row.thread_root_message_id,
    workspaceId: row.workspace_id,
  };
}

export const MESSAGE_SELECT_COLUMNS = `
  messages.message_id,
  messages.workspace_id,
  messages.conversation_id,
  messages.conversation_name,
  messages.conversation_type,
  messages.sender_id,
  messages.sender_name,
  messages.sender_type,
  messages.sender_organization,
  messages.sent_at,
  messages.text,
  messages.thread_root_message_id,
  messages.reply_to_message_id
`;
