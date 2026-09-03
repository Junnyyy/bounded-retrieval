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

export function parseMessageReference(
  reference: string,
  expectedCorpusVersion: string,
): string {
  let parsed: URL;
  try {
    parsed = new URL(reference);
  } catch {
    throw new Error(`Invalid message reference ${JSON.stringify(reference)}`);
  }
  const segments = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (
    parsed.protocol !== "corpus:" ||
    decodeURIComponent(parsed.hostname) !== expectedCorpusVersion ||
    segments.length !== 2 ||
    segments[0] !== "messages" ||
    segments[1] === ""
  ) {
    throw new Error(
      `Message reference does not belong to corpus ${expectedCorpusVersion}`,
    );
  }
  return segments[1]!;
}
