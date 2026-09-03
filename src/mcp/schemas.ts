import * as z from "zod/v4";

const clauseSchema = z.strictObject({
  match: z.enum(["literal", "phrase", "prefix"]),
  role: z.enum(["canonical", "alias"]),
  text: z.string().trim().min(1).max(128),
});

const filtersSchema = z.strictObject({
  conversation_ids: z.array(z.string().trim().min(1)).max(100).optional(),
  conversation_types: z
    .array(
      z.enum([
        "public_channel",
        "private_channel",
        "direct_message",
        "group_direct_message",
      ]),
    )
    .max(4)
    .optional(),
  from_inclusive: z.number().int().safe().nullable().optional(),
  sender_ids: z.array(z.string().trim().min(1)).max(100).optional(),
  sender_types: z.array(z.enum(["internal", "client"])).max(2).optional(),
  thread_ids: z.array(z.string().trim().min(1)).max(100).optional(),
  to_exclusive: z.number().int().safe().nullable().optional(),
});

export const structuredQuerySchema = z.strictObject({
  clauses: z.array(clauseSchema).min(1).max(8),
  combine: z.enum(["all", "any"]),
  filters: filtersSchema.optional(),
});

const baseQueryInput = {
  query: structuredQuerySchema.describe(
    "Structured lexical query. The agent interprets natural language; the server does not.",
  ),
};

export const measureInputSchema = z.strictObject(baseQueryInput);

export const discoverInputSchema = z.strictObject({
  ...baseQueryInput,
  limit: z.number().int().min(1).max(8).optional(),
});

export const sampleInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(8).optional(),
  query_ref: z.string().min(1).max(128),
  seed: z.string().min(1).max(128).optional(),
  strategy: z.enum(["uniform", "across_time", "across_conversations"]),
});

export const expandContextInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(20).optional(),
  message_ref: z.string().min(1).max(512),
  query_ref: z.string().min(1).max(128),
});

export const exportInputSchema = z.strictObject({
  query_ref: z.string().min(1).max(128),
});

const disclosureSchema = z.strictObject({
  cumulative_bytes: z.number().int().nonnegative(),
  remaining_bytes: z.number().int().nonnegative(),
  response_bytes: z.number().int().nonnegative(),
});

const limitsSchema = z.strictObject({
  cumulative_query_bytes: z.number().int().positive(),
  response_bytes: z.number().int().positive(),
});

export const resultEnvelopeSchema = z.strictObject({
  corpus_version: z.string(),
  disclosure: disclosureSchema,
  limits: limitsSchema,
  next_actions: z.array(z.string()),
  omitted: z.number().int().nonnegative().nullable(),
  outcome: z.enum(["complete", "incomplete"]),
  query_ref: z.string(),
  result: z.record(z.string(), z.unknown()),
  result_kind: z.string(),
  schema_version: z.literal("1"),
  truncated: z.boolean(),
});

export type StructuredQueryInput = z.infer<typeof structuredQuerySchema>;
