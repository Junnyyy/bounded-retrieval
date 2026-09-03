export const KIBIBYTE = 1_024;

export const RESULT_LIMITS = {
  cumulativeQueryBytes: 48 * KIBIBYTE,
  expandContextBytes: 12 * KIBIBYTE,
  measureBytes: 4 * KIBIBYTE,
  responseBytes: 16 * KIBIBYTE,
} as const;

export function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export class ResultSizeExceededError extends Error {
  readonly actualBytes: number;
  readonly maximumBytes: number;

  constructor(actualBytes: number, maximumBytes: number) {
    super(
      `Serialized result is ${actualBytes} bytes; maximum is ${maximumBytes} bytes`,
    );
    this.name = "ResultSizeExceededError";
    this.actualBytes = actualBytes;
    this.maximumBytes = maximumBytes;
  }
}

export function assertResultSize(value: unknown, maximumBytes: number): number {
  const bytes = serializedBytes(value);
  if (bytes > maximumBytes) {
    throw new ResultSizeExceededError(bytes, maximumBytes);
  }
  return bytes;
}
