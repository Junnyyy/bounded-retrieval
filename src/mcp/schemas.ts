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
  from_inclusive: z.number().int().safe().nullable().optional().describe("Inclusive UTC Unix timestamp in milliseconds."),
  sender_ids: z.array(z.string().trim().min(1)).max(100).optional(),
  sender_types: z.array(z.enum(["internal", "client"])).max(2).optional(),
  thread_ids: z.array(z.string().trim().min(1)).max(100).optional(),
  to_exclusive: z.number().int().safe().nullable().optional().describe("Exclusive UTC Unix timestamp in milliseconds."),
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

const envelopeFields = {
  corpus_version: z.string(),
  disclosure: disclosureSchema,
  limits: limitsSchema,
  next_actions: z.array(z.string()),
  omitted: z.number().int().nonnegative().nullable(),
  outcome: z.enum(["complete", "incomplete"]),
  query_ref: z.string(),
  schema_version: z.literal("2"),
  truncated: z.boolean(),
};

const count = z.number().int().nonnegative();
const scanReason = z.enum(["candidate_limit", "time_limit"]);
const stopReasons = z.array(z.enum([
  "item_limit", "candidate_limit", "time_limit", "response_byte_limit",
  "query_byte_limit", "context_window", "text_clipped",
]));
const metrics = z.strictObject({ conversations: count, messages: count, occurrences: count, threads: count });
const timeBuckets = z.array(z.strictObject({ day: z.string(), messages: count }));
const sender = z.strictObject({
  id: z.string(), name: z.string(), organization: z.string(), type: z.enum(["client", "internal"]),
});
const conversation = z.strictObject({
  id: z.string(), name: z.string(),
  type: z.enum(["public_channel", "private_channel", "direct_message", "group_direct_message"]),
});
const evidenceFields = {
  conversation,
  matched_roles: z.array(z.enum(["canonical", "alias"])),
  message_ref: z.string(), sender, sent_at: z.string(), snippet: z.string(),
  snippet_clipped: z.boolean(), thread_ref: z.string(),
};
const evidence = z.strictObject(evidenceFields);
const discoveryEvidence = z.strictObject({
  ...evidenceFields,
  same_text_matches: z.strictObject({ messages: count, senders: count, conversations: count, threads: count }).nullable(),
});

export const measureOutputSchema = z.strictObject({
  ...envelopeFields,
  result_kind: z.literal("measurement"),
  result: z.strictObject({
    candidate_rows_examined: count,
    normalized_query: structuredQuerySchema,
    metrics: metrics.optional(),
    provenance: z.strictObject({ alias: metrics, canonical: metrics }).optional(),
    time_buckets: timeBuckets.optional(),
    reason: scanReason.optional(),
    stop_reasons: stopReasons,
  }),
});

export const discoverOutputSchema = z.strictObject({
  ...envelopeFields,
  result_kind: z.literal("discovery"),
  result: z.strictObject({
    candidate_rows_examined: count,
    evidence: z.array(discoveryEvidence).max(8),
    normalized_query: structuredQuerySchema,
    selection: z.strictObject({
      kind: z.literal("ranked_exact_text_and_thread_diverse"),
      exhaustive: z.boolean(), stop_reasons: stopReasons,
    }),
    shape: z.strictObject({ metrics: metrics.optional(), time_buckets: timeBuckets.optional(), reason: scanReason.optional() }),
  }),
});

export const sampleOutputSchema = z.strictObject({
  ...envelopeFields,
  result_kind: z.literal("sample"),
  result: z.strictObject({
    candidate_rows_examined: count,
    evidence: z.array(evidence).max(8),
    population: z.strictObject({
      unit: z.literal("message"), excludes_disclosed: z.literal(true),
      messages: count.nullable(), strata: count.nullable(),
    }),
    selection: z.strictObject({
      kind: z.enum(["uniform", "across_time", "across_conversations"]),
      seed: z.string(), exhaustive: z.boolean(), returned_strata: count,
      stop_reasons: stopReasons,
    }),
  }),
});

export const expandContextOutputSchema = z.strictObject({
  ...envelopeFields,
  result_kind: z.literal("message_context"),
  result: z.strictObject({
    anchor_message_id: z.string(), clipped_after: z.boolean(), clipped_before: z.boolean(),
    context_kind: z.enum(["conversation", "thread"]),
    messages: z.array(z.strictObject({
      message_id: z.string(), message_ref: z.string(), reply_to_message_id: z.string().nullable(),
      sender, sent_at: z.string(), text: z.string(), text_clipped: z.boolean(),
    })).max(20),
    stop_reasons: stopReasons,
  }),
});

export const exportOutputSchema = z.strictObject({
  ...envelopeFields,
  result_kind: z.literal("export"),
  result: z.strictObject({
    outcome: z.enum(["complete", "incomplete"]),
    artifact_path: z.string().optional(), bytes: count.optional(), corpus_version: z.string().optional(),
    format: z.literal("jsonl").optional(), message_ids_sha256: z.string().optional(),
    mime_type: z.literal("application/x-ndjson").optional(), rows: count.optional(), sha256: z.string().optional(),
    candidate_rows_examined: count.optional(), reason: scanReason.optional(),
  }),
});

export type StructuredQueryInput = z.infer<typeof structuredQuerySchema>;
