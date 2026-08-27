export type TokenBucketDecision = { allowed: true; retryAfter: 0 } | { allowed: false; retryAfter: number };

type Bucket = { tokens: number; updatedAt: number };

/** Continuously refilling, process-local token bucket. */
export class TokenBucketLimiter {
  private buckets = new Map<string, Bucket>();

  take(key: string, capacity: number, refillPerSecond: number, nowMs = Date.now()): TokenBucketDecision {
    if (capacity <= 0 || refillPerSecond <= 0) return { allowed: true, retryAfter: 0 };
    const previous = this.buckets.get(key) ?? { tokens: capacity, updatedAt: nowMs };
    const elapsedSeconds = Math.max(0, nowMs - previous.updatedAt) / 1000;
    const tokens = Math.min(capacity, previous.tokens + elapsedSeconds * refillPerSecond);
    if (tokens < 1) {
      this.buckets.set(key, { tokens, updatedAt: nowMs });
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((1 - tokens) / refillPerSecond)) };
    }
    this.buckets.set(key, { tokens: tokens - 1, updatedAt: nowMs });
    if (this.buckets.size > 10_000) {
      const staleBefore = nowMs - Math.ceil(capacity / refillPerSecond) * 2000;
      for (const [bucketKey, bucket] of this.buckets) {
        if (bucket.updatedAt < staleBefore) this.buckets.delete(bucketKey);
      }
    }
    return { allowed: true, retryAfter: 0 };
  }
}
