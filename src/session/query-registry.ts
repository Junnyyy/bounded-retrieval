import { randomBytes } from "node:crypto";

import { RESULT_LIMITS } from "../budget/limits.ts";
import {
  normalizeQuery,
  queryDigest,
  type NormalizedQuery,
  type StructuredQuery,
} from "../retrieval/query.ts";

export interface QueryDisclosure {
  readonly bytes: number;
  readonly messageCount: number;
  readonly remainingBytes: number;
}

export interface QuerySnapshot {
  readonly corpusVersion: string;
  readonly createdAt: string;
  readonly disclosure: QueryDisclosure;
  readonly query: NormalizedQuery;
  readonly queryDigest: string;
  readonly queryRef: string;
}

interface MutableQueryState {
  readonly corpusVersion: string;
  readonly createdAt: string;
  disclosureBytes: number;
  readonly disclosedMessageIds: Set<string>;
  readonly query: NormalizedQuery;
  readonly queryDigest: string;
  readonly queryRef: string;
}

export class QueryReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryReferenceError";
  }
}

export class DisclosureBudgetExceededError extends Error {
  readonly attemptedBytes: number;
  readonly remainingBytes: number;

  constructor(attemptedBytes: number, remainingBytes: number) {
    super(
      `Result requires ${attemptedBytes} bytes but this query has ${remainingBytes} disclosure bytes remaining`,
    );
    this.name = "DisclosureBudgetExceededError";
    this.attemptedBytes = attemptedBytes;
    this.remainingBytes = remainingBytes;
  }
}

function opaqueReference(): string {
  return `query_${randomBytes(18).toString("base64url")}`;
}

export class QueryRegistry {
  readonly #corpusVersion: string;
  readonly #referencesByDigest = new Map<string, string>();
  readonly #statesByReference = new Map<string, MutableQueryState>();

  constructor(corpusVersion: string) {
    this.#corpusVersion = corpusVersion;
  }

  register(query: StructuredQuery): QuerySnapshot {
    const normalized = normalizeQuery(query);
    const digest = queryDigest(normalized);
    const existingReference = this.#referencesByDigest.get(digest);
    if (existingReference !== undefined) {
      return this.get(existingReference);
    }

    const queryRef = opaqueReference();
    const state: MutableQueryState = {
      corpusVersion: this.#corpusVersion,
      createdAt: new Date().toISOString(),
      disclosureBytes: 0,
      disclosedMessageIds: new Set(),
      query: normalized,
      queryDigest: digest,
      queryRef,
    };
    this.#referencesByDigest.set(digest, queryRef);
    this.#statesByReference.set(queryRef, state);
    return this.#snapshot(state);
  }

  get(queryRef: string): QuerySnapshot {
    return this.#snapshot(this.#state(queryRef));
  }

  disclosedMessageIds(queryRef: string): ReadonlySet<string> {
    return new Set(this.#state(queryRef).disclosedMessageIds);
  }

  hasDisclosedMessage(queryRef: string, messageId: string): boolean {
    return this.#state(queryRef).disclosedMessageIds.has(messageId);
  }

  recordDisclosure(
    queryRef: string,
    bytes: number,
    messageIds: readonly string[] = [],
  ): QuerySnapshot {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error("Disclosure bytes must be a non-negative safe integer");
    }
    const state = this.#state(queryRef);
    const remaining = RESULT_LIMITS.cumulativeQueryBytes - state.disclosureBytes;
    if (bytes > remaining) {
      throw new DisclosureBudgetExceededError(bytes, remaining);
    }

    state.disclosureBytes += bytes;
    for (const messageId of messageIds) {
      state.disclosedMessageIds.add(messageId);
    }
    return this.#snapshot(state);
  }

  #state(queryRef: string): MutableQueryState {
    const state = this.#statesByReference.get(queryRef);
    if (state === undefined) {
      throw new QueryReferenceError(
        `Unknown or expired query reference ${JSON.stringify(queryRef)}`,
      );
    }
    if (state.corpusVersion !== this.#corpusVersion) {
      throw new QueryReferenceError("Query reference belongs to another corpus");
    }
    return state;
  }

  #snapshot(state: MutableQueryState): QuerySnapshot {
    return {
      corpusVersion: state.corpusVersion,
      createdAt: state.createdAt,
      disclosure: {
        bytes: state.disclosureBytes,
        messageCount: state.disclosedMessageIds.size,
        remainingBytes:
          RESULT_LIMITS.cumulativeQueryBytes - state.disclosureBytes,
      },
      query: state.query,
      queryDigest: state.queryDigest,
      queryRef: state.queryRef,
    };
  }
}
