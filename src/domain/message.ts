export const CONVERSATION_TYPES = [
  "public_channel",
  "private_channel",
  "direct_message",
  "group_direct_message",
] as const;

export type ConversationType = (typeof CONVERSATION_TYPES)[number];

export const SENDER_TYPES = ["internal", "client"] as const;

export type SenderType = (typeof SENDER_TYPES)[number];

export interface MessageRecord {
  readonly conversationId: string;
  readonly conversationName: string;
  readonly conversationType: ConversationType;
  readonly messageId: string;
  readonly replyToMessageId: string | null;
  readonly senderId: string;
  readonly senderName: string;
  readonly senderOrganization: string;
  readonly senderType: SenderType;
  readonly sentAt: number;
  readonly text: string;
  readonly threadRootMessageId: string | null;
  readonly workspaceId: string;
}

export function threadIdentity(message: MessageRecord): string {
  return message.threadRootMessageId ?? message.messageId;
}
