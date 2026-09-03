function hashSeed(seed: string): number {
  let hash = 2_166_136_261;

  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

export interface DeterministicRandom {
  readonly integer: (maximumExclusive: number) => number;
  readonly next: () => number;
  readonly pick: <Value>(values: readonly Value[]) => Value;
}

export function createDeterministicRandom(seed: string): DeterministicRandom {
  let state = hashSeed(seed) || 0x6d2b79f5;

  const next = (): number => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };

  return {
    integer(maximumExclusive) {
      if (!Number.isSafeInteger(maximumExclusive) || maximumExclusive <= 0) {
        throw new Error("maximumExclusive must be a positive safe integer");
      }

      return Math.floor(next() * maximumExclusive);
    },
    next,
    pick<Value>(values: readonly Value[]): Value {
      if (values.length === 0) {
        throw new Error("Cannot select from an empty collection");
      }

      return values[Math.floor(next() * values.length)] as Value;
    },
  };
}
