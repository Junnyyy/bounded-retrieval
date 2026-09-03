export const CORPUS_PROFILE_NAMES = [
  "week",
  "month",
  "million",
  "stress",
] as const;

export type CorpusProfileName = (typeof CORPUS_PROFILE_NAMES)[number];

export interface CorpusProfile {
  readonly days: number;
  readonly description: string;
  readonly messageCount: number;
  readonly name: CorpusProfileName;
  readonly participantCount: number;
  readonly realistic: boolean;
}

export const CORPUS_PROFILES: Readonly<
  Record<CorpusProfileName, CorpusProfile>
> = {
  week: {
    days: 7,
    description: "A busy but plausible week of sales conversations",
    messageCount: 10_000,
    name: "week",
    participantCount: 20,
    realistic: true,
  },
  month: {
    days: 30,
    description: "A busy but plausible month of sales conversations",
    messageCount: 40_000,
    name: "month",
    participantCount: 20,
    realistic: true,
  },
  million: {
    days: 30,
    description: "An intentionally artificial million-message scale fixture",
    messageCount: 1_000_000,
    name: "million",
    participantCount: 20,
    realistic: false,
  },
  stress: {
    days: 30,
    description: "An intentionally artificial ten-million-message stress fixture",
    messageCount: 10_000_000,
    name: "stress",
    participantCount: 20,
    realistic: false,
  },
};

export function resolveCorpusProfile(name: string): CorpusProfile {
  if (!CORPUS_PROFILE_NAMES.includes(name as CorpusProfileName)) {
    throw new Error(
      `Unknown corpus profile ${JSON.stringify(name)}. Expected one of: ${CORPUS_PROFILE_NAMES.join(", ")}`,
    );
  }

  return CORPUS_PROFILES[name as CorpusProfileName];
}
