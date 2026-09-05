import type { CorpusGroundTruth } from "../corpus/generate.ts";
import { parseMessageReference } from "../retrieval/references.ts";
import type { EncodedResult } from "../service/result-envelope.ts";

type Result = EncodedResult<Record<string, unknown>>;

interface VisibleEvidence {
  readonly conversation?: { readonly id: string };
  readonly message_ref: string;
  readonly sent_at: string;
  readonly snippet?: string;
  readonly snippet_clipped?: boolean;
  readonly text?: string;
  readonly text_clipped?: boolean;
}

// Evaluation only. Neither retrieval nor the MCP service imports these labels.
export function scoreEvidence(results: readonly Result[], truth: CorpusGroundTruth) {
  const labels = new Map(truth.concerns.flatMap((concern) =>
    concern.supportingMessageIds.map((id) => [id, concern.category] as const),
  ));
  const references = new Set<string>();
  const excerpts = new Set<string>();
  const days = new Set<string>();
  const conversations = new Set<string>();
  const support = new Map<string, Set<string>>();
  let repeatedExcerptBytes = 0;
  let clippedItems = 0;
  let visibleItems = 0;
  for (const result of results) {
    const payload = result.envelope.result as {
      readonly evidence?: readonly VisibleEvidence[];
      readonly messages?: readonly VisibleEvidence[];
    };
    for (const item of payload.evidence ?? payload.messages ?? []) {
      visibleItems += 1;
      const text = item.snippet ?? item.text ?? "";
      const clipped = item.snippet_clipped === true || item.text_clipped === true;
      if (clipped) clippedItems += 1;
      if (excerpts.has(text)) repeatedExcerptBytes += Buffer.byteLength(text, "utf8");
      excerpts.add(text);
      references.add(item.message_ref);
      days.add(item.sent_at.slice(0, 10));
      if (item.conversation !== undefined) conversations.add(item.conversation.id);
      const id = parseMessageReference(item.message_ref, truth.corpusVersion);
      const category = labels.get(id);
      // A label on a full message does not prove that its clipped excerpt supports
      // the claim. Conservatively count only fully visible labeled messages.
      if (category !== undefined && !clipped) {
        const categorySupport = support.get(category) ?? new Set<string>();
        categorySupport.add(item.message_ref);
        support.set(category, categorySupport);
      }
    }
  }
  const supportedCategories = [...support.keys()].sort();
  const missingCategories = truth.concerns.map((c) => c.category)
    .filter((category) => !support.has(category)).sort();
  return {
    allCategoriesSupported: missingCategories.length === 0,
    clippedItems,
    conversations: conversations.size,
    days: days.size,
    missingCategories,
    repeatedExcerptBytes,
    supportedCategories,
    supportingReferences: Object.fromEntries([...support.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, refs]) => [category, [...refs].sort()])),
    uniqueExcerpts: excerpts.size,
    uniqueMessages: references.size,
    visibleItems,
  };
}
