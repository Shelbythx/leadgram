import { createHash } from 'node:crypto';

const PART_SEPARATOR = '\u0000';

export function fingerprint(...parts: Array<string | undefined>): string {
  return createHash('sha256')
    .update(parts.map((part) => part ?? '').join(PART_SEPARATOR))
    .digest('base64url');
}

export class DuplicateGuard {
  readonly #rememberedAt = new Map<string, number>();
  readonly #ttlMs: number;

  constructor(ttlMs: number) {
    this.#ttlMs = ttlMs;
  }

  has(key: string, now: number): boolean {
    const rememberedAt = this.#rememberedAt.get(key);
    return rememberedAt !== undefined && !this.#isExpired(rememberedAt, now);
  }

  remember(key: string, now: number): void {
    this.#evictExpired(now);
    this.#rememberedAt.set(key, now);
  }

  forget(key: string): void {
    this.#rememberedAt.delete(key);
  }

  #evictExpired(now: number): void {
    for (const [key, rememberedAt] of this.#rememberedAt) {
      if (this.#isExpired(rememberedAt, now)) this.#rememberedAt.delete(key);
    }
  }

  #isExpired(rememberedAt: number, now: number): boolean {
    return rememberedAt <= now - this.#ttlMs;
  }
}
