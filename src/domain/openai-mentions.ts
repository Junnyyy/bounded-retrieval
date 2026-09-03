const OPENAI_MENTION_PATTERN =
  /(?<![\p{L}\p{N}])OpenAI(?![\p{L}\p{N}])/giu;

export interface TextMatch {
  readonly end: number;
  readonly start: number;
  readonly text: string;
}

export function findOpenAiMentions(text: string): readonly TextMatch[] {
  return Array.from(text.matchAll(OPENAI_MENTION_PATTERN), (match) => ({
    end: (match.index ?? 0) + match[0].length,
    start: match.index ?? 0,
    text: match[0],
  }));
}

export function countOpenAiMentions(text: string): number {
  return findOpenAiMentions(text).length;
}
