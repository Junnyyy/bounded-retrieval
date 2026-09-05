import {
  RESULT_LIMITS,
  ResultSizeExceededError,
  serializedBytes,
} from "../budget/limits.ts";
import type { QueryRegistry, QuerySnapshot } from "../session/query-registry.ts";

export const SCHEMA_VERSION = "2";

export type ByteLimitReason = "response_byte_limit" | "query_byte_limit";

export interface ResultEnvelope<Result extends object> {
  readonly corpus_version: string;
  readonly disclosure: {
    readonly cumulative_bytes: number;
    readonly remaining_bytes: number;
    readonly response_bytes: number;
  };
  readonly limits: {
    readonly cumulative_query_bytes: number;
    readonly response_bytes: number;
  };
  readonly next_actions: readonly string[];
  readonly omitted: number | null;
  readonly outcome: "complete" | "incomplete";
  readonly query_ref: string;
  readonly result: Result;
  readonly result_kind: string;
  readonly schema_version: typeof SCHEMA_VERSION;
  readonly truncated: boolean;
}

export interface McpCompatibleResult<Result extends object> {
  readonly content: readonly [{ readonly text: string; readonly type: "text" }];
  readonly structuredContent: ResultEnvelope<Result>;
}

export interface EncodedResult<Result extends object> {
  readonly bytes: number;
  readonly envelope: ResultEnvelope<Result>;
  readonly mcpResult: McpCompatibleResult<Result>;
}

interface FinalizeOptions<Result extends object> {
  readonly maximumBytes: number;
  readonly messageIds: () => readonly string[];
  readonly nextActions: readonly string[] | (() => readonly string[]);
  readonly omitted: () => number | null;
  readonly outcome: "complete" | "incomplete";
  readonly queryRef: string;
  readonly registry: QueryRegistry;
  readonly result: () => Result;
  readonly resultKind: string;
  readonly shrink: (reasons: readonly ByteLimitReason[]) => boolean;
  readonly truncated: () => boolean;
}

function createMcpResult<Result extends object>(
  envelope: ResultEnvelope<Result>,
): McpCompatibleResult<Result> {
  return {
    content: [{ text: JSON.stringify(envelope), type: "text" }],
    structuredContent: envelope,
  };
}

function envelopeFor<Result extends object>(
  snapshot: QuerySnapshot,
  options: FinalizeOptions<Result>,
  responseBytes: number,
): ResultEnvelope<Result> {
  const cumulativeBytes = snapshot.disclosure.bytes + responseBytes;
  return {
    corpus_version: snapshot.corpusVersion,
    disclosure: {
      cumulative_bytes: cumulativeBytes,
      remaining_bytes: Math.max(
        0,
        RESULT_LIMITS.cumulativeQueryBytes - cumulativeBytes,
      ),
      response_bytes: responseBytes,
    },
    limits: {
      cumulative_query_bytes: RESULT_LIMITS.cumulativeQueryBytes,
      response_bytes: options.maximumBytes,
    },
    next_actions: typeof options.nextActions === "function" ? options.nextActions() : options.nextActions,
    omitted: options.omitted(),
    outcome: options.outcome,
    query_ref: snapshot.queryRef,
    result: options.result(),
    result_kind: options.resultKind,
    schema_version: SCHEMA_VERSION,
    truncated: options.truncated(),
  };
}

function encodeStable<Result extends object>(
  snapshot: QuerySnapshot,
  options: FinalizeOptions<Result>,
): EncodedResult<Result> {
  let responseBytes = 0;
  let envelope = envelopeFor(snapshot, options, responseBytes);
  let mcpResult = createMcpResult(envelope);

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const measuredBytes = serializedBytes(mcpResult);
    if (measuredBytes === responseBytes) {
      return { bytes: measuredBytes, envelope, mcpResult };
    }
    responseBytes = measuredBytes;
    envelope = envelopeFor(snapshot, options, responseBytes);
    mcpResult = createMcpResult(envelope);
  }

  const measuredBytes = serializedBytes(mcpResult);
  return { bytes: measuredBytes, envelope, mcpResult };
}

export function finalizeResult<Result extends object>(
  options: FinalizeOptions<Result>,
): EncodedResult<Result> {
  const snapshot = options.registry.get(options.queryRef);

  for (;;) {
    const encoded = encodeStable(snapshot, options);
    const fitsResponse = encoded.bytes <= options.maximumBytes;
    const fitsDisclosure =
      encoded.bytes <= snapshot.disclosure.remainingBytes;
    if (fitsResponse && fitsDisclosure) {
      options.registry.recordDisclosure(
        options.queryRef,
        encoded.bytes,
        options.messageIds(),
      );
      return encoded;
    }
    const reasons: ByteLimitReason[] = [];
    if (!fitsResponse) reasons.push("response_byte_limit");
    if (!fitsDisclosure) reasons.push("query_byte_limit");
    if (!options.shrink(reasons)) {
      throw new ResultSizeExceededError(
        encoded.bytes,
        Math.min(options.maximumBytes, snapshot.disclosure.remainingBytes),
      );
    }
  }
}
