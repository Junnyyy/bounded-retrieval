function referenceSegment(value: string): string {
  return encodeURIComponent(value);
}

export function messageReference(
  corpusVersion: string,
  messageId: string,
): string {
  return `corpus://${referenceSegment(corpusVersion)}/messages/${referenceSegment(messageId)}`;
}

export function threadReference(
  corpusVersion: string,
  threadId: string,
): string {
  return `corpus://${referenceSegment(corpusVersion)}/threads/${referenceSegment(threadId)}`;
}

export function conversationReference(
  corpusVersion: string,
  conversationId: string,
): string {
  return `corpus://${referenceSegment(corpusVersion)}/conversations/${referenceSegment(conversationId)}`;
}
