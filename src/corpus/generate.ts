import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";

import { countOpenAiMentions } from "../domain/openai-mentions.ts";
import {
  threadIdentity,
  type ConversationType,
  type MessageRecord,
  type SenderType,
} from "../domain/message.ts";
import { openCorpusDatabase, type CorpusMetadata } from "../database/corpus.ts";
import { buildFullTextIndex, createCorpusSchema } from "../database/schema.ts";
import type { CorpusProfile } from "./profiles.ts";
import { createDeterministicRandom } from "./random.ts";

const DEFAULT_START_TIME = Date.parse("2026-01-05T14:00:00.000Z");
const DAY_IN_MILLISECONDS = 86_400_000;
const INSERT_BATCH_SIZE = 10_000;

const INTERNAL_NAMES = [
  "Avery Chen",
  "Jordan Bell",
  "Morgan Diaz",
  "Riley Evans",
  "Casey Flores",
  "Taylor Green",
  "Jamie Hall",
  "Cameron Imani",
  "Drew Jensen",
  "Quinn Kim",
] as const;

const CLIENTS = [
  ["Alex Laurent", "Juniper Foods"],
  ["Blair Morgan", "Juniper Foods"],
  ["Chris Novak", "Helio Systems"],
  ["Devon Ortiz", "Helio Systems"],
  ["Ellis Park", "Cedar Labs"],
  ["Frankie Reed", "Cedar Labs"],
  ["Gray Shah", "Atlas Works"],
  ["Harper Tran", "Atlas Works"],
  ["Indigo Vega", "Northwind Studio"],
  ["Jules Wu", "Northwind Studio"],
] as const;

const CONCERN_TEMPLATES = [
  {
    category: "pricing",
    text: "Our main OpenAI concern is pricing predictability as usage grows.",
  },
  {
    category: "data_privacy",
    text: "Before we proceed with OpenAI, our security team needs clearer data privacy terms.",
  },
  {
    category: "reliability",
    text: "We are concerned that OpenAI availability could affect our customer workflow.",
  },
  {
    category: "model_quality",
    text: "The OpenAI-powered draft still needs a human review for subtle account details.",
  },
  {
    category: "vendor_lock_in",
    text: "Does adopting OpenAI make it difficult to switch providers later?",
  },
] as const;

const EXACT_MENTION_TEMPLATES = [
  "OpenAI came up in today's account review.",
  "The client asked whether openai is on our approved vendor list.",
  "Please add @OpenAI to the comparison notes.",
  "OpenAI's release schedule may affect our proposal.",
  "The OpenAI-powered workflow performed well in the trial.",
  "The procurement team referenced OpenAI.com in its notes.",
  "OpenAI and OpenAI pricing both came up in the same call.",
] as const;

const NEAR_MISS_TEMPLATES = [
  "The client wrote Open AI as two words in the questionnaire.",
  "The draft calls it Open-AI with a hyphen.",
  "One imported note contains the accented form OpenAÍ.",
  "ChatGPT appeared in an unrelated enablement conversation.",
] as const;

const ORDINARY_TEMPLATES = [
  "Can we move the account review to Thursday afternoon?",
  "I added the revised implementation timeline to the shared notes.",
  "The client asked for a shorter procurement checklist.",
  "We should confirm who owns the follow-up before tomorrow's call.",
  "The pilot group is ready for another round of feedback.",
  "Please capture the decision and the unresolved question in the recap.",
  "The renewal discussion was constructive but still needs legal review.",
  "I will send the updated pricing worksheet after lunch.",
  "The customer wants clearer examples before inviting the wider team.",
  "Nothing urgent here; this is a note for next week's planning session.",
] as const;

interface PersonDefinition {
  readonly id: string;
  readonly name: string;
  readonly organization: string;
  readonly type: SenderType;
}

interface ConversationDefinition {
  readonly allowedSenderIds: readonly string[];
  readonly id: string;
  readonly name: string;
  readonly type: ConversationType;
}

export interface ConcernGroundTruth {
  readonly category: string;
  readonly supportingMessageIds: readonly string[];
}

export interface CorpusGroundTruth {
  readonly concerns: readonly ConcernGroundTruth[];
  readonly corpusVersion: string;
  readonly openAi: {
    readonly distinctConversations: number;
    readonly distinctThreads: number;
    readonly matchingMessageCount: number;
    readonly matchingMessageIdsSha256: string;
    readonly occurrenceCount: number;
  };
  readonly profile: string;
  readonly seed: string;
}

export interface GenerateCorpusOptions {
  readonly databasePath: string;
  readonly groundTruthPath?: string;
  readonly overwrite?: boolean;
  readonly profile: CorpusProfile;
  readonly seed: string;
}

export interface GenerateCorpusResult {
  readonly databasePath: string;
  readonly groundTruth: CorpusGroundTruth;
  readonly groundTruthPath: string;
  readonly metadata: CorpusMetadata;
}

function createPeople(): readonly PersonDefinition[] {
  const internal = INTERNAL_NAMES.map((name, index) => ({
    id: `internal-${String(index + 1).padStart(2, "0")}`,
    name,
    organization: "Fieldcraft",
    type: "internal" as const,
  }));
  const clients = CLIENTS.map(([name, organization], index) => ({
    id: `client-${String(index + 1).padStart(2, "0")}`,
    name,
    organization,
    type: "client" as const,
  }));
  return [...internal, ...clients];
}

function createConversations(
  people: readonly PersonDefinition[],
): readonly ConversationDefinition[] {
  const internalIds = people
    .filter((person) => person.type === "internal")
    .map((person) => person.id);
  const clientGroups = Map.groupBy(
    people.filter((person) => person.type === "client"),
    (person) => person.organization,
  );
  const conversations: ConversationDefinition[] = [
    {
      allowedSenderIds: internalIds,
      id: "channel-sales",
      name: "sales",
      type: "public_channel",
    },
    {
      allowedSenderIds: internalIds,
      id: "channel-deal-desk",
      name: "deal-desk",
      type: "private_channel",
    },
    {
      allowedSenderIds: internalIds.slice(0, 5),
      id: "group-sales-leads",
      name: "sales leads",
      type: "group_direct_message",
    },
  ];

  let clientIndex = 0;
  for (const [organization, clients] of clientGroups) {
    const clientIds = clients.map((person) => person.id);
    const slug = organization.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-");
    conversations.push(
      {
        allowedSenderIds: [...internalIds.slice(0, 4), ...clientIds],
        id: `client-${slug}`,
        name: `${organization} shared account`,
        type: "private_channel",
      },
      {
        allowedSenderIds: [internalIds[clientIndex % internalIds.length]!, clientIds[0]!],
        id: `dm-${slug}`,
        name: `${organization} account DM`,
        type: "direct_message",
      },
    );
    clientIndex += 1;
  }

  return conversations;
}

function corpusVersion(profile: CorpusProfile, seed: string): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        generator: 1,
        profile: profile.name,
        messageCount: profile.messageCount,
        seed,
      }),
    )
    .digest("hex")
    .slice(0, 16);
  return `corpus-${digest}`;
}

function insertMetadata(
  database: DatabaseSync,
  metadata: CorpusMetadata,
): void {
  const statement = database.prepare(
    "INSERT INTO corpus_metadata(key, value) VALUES (?, ?)",
  );
  const values = {
    generated_at: metadata.generatedAt,
    message_count: String(metadata.messageCount),
    profile: metadata.profile,
    realistic: String(metadata.realistic),
    seed: metadata.seed,
    version: metadata.version,
  };

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const [key, value] of Object.entries(values)) {
      statement.run(key, value);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function prepareMessageInsert(database: DatabaseSync): StatementSync {
  return database.prepare(`
    INSERT INTO messages(
      message_id,
      workspace_id,
      conversation_id,
      conversation_name,
      conversation_type,
      sender_id,
      sender_name,
      sender_type,
      sender_organization,
      sent_at,
      text,
      thread_root_message_id,
      reply_to_message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
}

function insertMessage(statement: StatementSync, message: MessageRecord): void {
  statement.run(
    message.messageId,
    message.workspaceId,
    message.conversationId,
    message.conversationName,
    message.conversationType,
    message.senderId,
    message.senderName,
    message.senderType,
    message.senderOrganization,
    message.sentAt,
    message.text,
    message.threadRootMessageId,
    message.replyToMessageId,
  );
}

function messageText(
  index: number,
  senderType: SenderType,
): { readonly concernCategory: string | null; readonly text: string } {
  if (senderType === "client" && index % 503 === 0) {
    const concern = CONCERN_TEMPLATES[
      Math.floor(index / 503) % CONCERN_TEMPLATES.length
    ]!;
    return { concernCategory: concern.category, text: concern.text };
  }

  if (index % 37 === 0) {
    return {
      concernCategory: null,
      text: EXACT_MENTION_TEMPLATES[
        Math.floor(index / 37) % EXACT_MENTION_TEMPLATES.length
      ]!,
    };
  }

  if (index % 41 === 0) {
    return {
      concernCategory: null,
      text: NEAR_MISS_TEMPLATES[
        Math.floor(index / 41) % NEAR_MISS_TEMPLATES.length
      ]!,
    };
  }

  return {
    concernCategory: null,
    text: ORDINARY_TEMPLATES[index % ORDINARY_TEMPLATES.length]!,
  };
}

function writeGroundTruth(path: string, truth: CorpusGroundTruth): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(truth, null, 2)}\n`, "utf8");
}

export function generateCorpus(
  options: GenerateCorpusOptions,
): GenerateCorpusResult {
  if (options.profile.participantCount !== 20) {
    throw new Error("The V1 generator requires exactly 20 participants");
  }

  const databasePath = resolve(options.databasePath);
  const groundTruthPath = resolve(
    options.groundTruthPath ?? `${databasePath}.ground-truth.json`,
  );
  for (const outputPath of [databasePath, groundTruthPath]) {
    if (existsSync(outputPath)) {
      if (!options.overwrite) {
        throw new Error(
          `${outputPath} already exists; pass overwrite to replace generated output`,
        );
      }
      rmSync(outputPath);
    }
  }

  mkdirSync(dirname(databasePath), { recursive: true });
  const version = corpusVersion(options.profile, options.seed);
  const metadata: CorpusMetadata = {
    generatedAt: new Date(DEFAULT_START_TIME).toISOString(),
    messageCount: options.profile.messageCount,
    profile: options.profile.name,
    realistic: options.profile.realistic,
    seed: options.seed,
    version,
  };
  const people = createPeople();
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const conversations = createConversations(people);
  const random = createDeterministicRandom(
    `${options.seed}:${options.profile.name}`,
  );
  const database = openCorpusDatabase(databasePath);
  const matchingIdDigest = createHash("sha256");
  const matchingThreads = new Set<string>();
  const matchingConversations = new Set<string>();
  const concerns = new Map<string, string[]>();
  let matchingMessageCount = 0;
  let occurrenceCount = 0;
  const lastThreadRoot = new Map<string, string>();
  const lastThreadMessage = new Map<string, string>();

  try {
    createCorpusSchema(database);
    insertMetadata(database, metadata);
    const insert = prepareMessageInsert(database);
    const totalDuration = options.profile.days * DAY_IN_MILLISECONDS;

    database.exec("BEGIN IMMEDIATE");
    try {
      for (let index = 0; index < options.profile.messageCount; index += 1) {
        const defaultConversation = random.pick(conversations);
        const shouldBeConcern = index % 503 === 0;
        const eligibleConversations = shouldBeConcern
          ? conversations.filter((conversation) =>
              conversation.allowedSenderIds.some(
                (senderId) => peopleById.get(senderId)?.type === "client",
              ),
            )
          : conversations;
        const conversation = shouldBeConcern
          ? random.pick(eligibleConversations)
          : defaultConversation;
        const eligibleSenders = conversation.allowedSenderIds
          .map((senderId) => peopleById.get(senderId))
          .filter(
            (person): person is PersonDefinition =>
              person !== undefined &&
              (!shouldBeConcern || person.type === "client"),
          );
        const sender = random.pick(eligibleSenders);
        const messageId = `message-${String(index + 1).padStart(9, "0")}`;
        const hasThread = lastThreadRoot.has(conversation.id);
        const isReply = hasThread && random.next() < 0.24;
        const threadRootMessageId = isReply
          ? lastThreadRoot.get(conversation.id) ?? null
          : null;
        const replyToMessageId = isReply
          ? lastThreadMessage.get(conversation.id) ?? threadRootMessageId
          : null;
        const generatedText = messageText(index, sender.type);
        const message: MessageRecord = {
          conversationId: conversation.id,
          conversationName: conversation.name,
          conversationType: conversation.type,
          messageId,
          replyToMessageId,
          senderId: sender.id,
          senderName: sender.name,
          senderOrganization: sender.organization,
          senderType: sender.type,
          sentAt:
            DEFAULT_START_TIME +
            Math.floor((index * totalDuration) / options.profile.messageCount),
          text: generatedText.text,
          threadRootMessageId,
          workspaceId: "workspace-demo",
        };

        insertMessage(insert, message);

        if (isReply && threadRootMessageId !== null) {
          lastThreadMessage.set(conversation.id, messageId);
        } else if (random.next() < 0.18) {
          lastThreadRoot.set(conversation.id, messageId);
          lastThreadMessage.set(conversation.id, messageId);
        }

        const mentions = countOpenAiMentions(message.text);
        if (mentions > 0) {
          matchingMessageCount += 1;
          occurrenceCount += mentions;
          matchingIdDigest.update(`${message.messageId}\n`);
          matchingThreads.add(threadIdentity(message));
          matchingConversations.add(message.conversationId);
        }

        if (generatedText.concernCategory !== null) {
          const existing = concerns.get(generatedText.concernCategory) ?? [];
          existing.push(message.messageId);
          concerns.set(generatedText.concernCategory, existing);
        }

        if (
          (index + 1) % INSERT_BATCH_SIZE === 0 &&
          index + 1 < options.profile.messageCount
        ) {
          database.exec("COMMIT; BEGIN IMMEDIATE");
        }
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    buildFullTextIndex(database);
    database.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA optimize;");
  } finally {
    database.close();
  }

  const groundTruth: CorpusGroundTruth = {
    concerns: Array.from(concerns, ([category, supportingMessageIds]) => ({
      category,
      supportingMessageIds,
    })).sort((left, right) => left.category.localeCompare(right.category)),
    corpusVersion: version,
    openAi: {
      distinctConversations: matchingConversations.size,
      distinctThreads: matchingThreads.size,
      matchingMessageCount,
      matchingMessageIdsSha256: matchingIdDigest.digest("hex"),
      occurrenceCount,
    },
    profile: options.profile.name,
    seed: options.seed,
  };
  writeGroundTruth(groundTruthPath, groundTruth);

  return { databasePath, groundTruth, groundTruthPath, metadata };
}
