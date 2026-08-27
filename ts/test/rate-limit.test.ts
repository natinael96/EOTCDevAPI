import { describe, expect, it } from 'vitest';
import { TokenBucketLimiter } from '../src/core/rate-limit.ts';

describe('dynamic token bucket', () => {
  it('allows bursts and continuously refills capacity', () => {
    const limiter = new TokenBucketLimiter();
    expect(limiter.take('a', 2, 0.5, 0).allowed).toBe(true);
    expect(limiter.take('a', 2, 0.5, 0).allowed).toBe(true);
    expect(limiter.take('a', 2, 0.5, 0)).toEqual({ allowed: false, retryAfter: 2 });
    expect(limiter.take('a', 2, 0.5, 1000)).toEqual({ allowed: false, retryAfter: 1 });
    expect(limiter.take('a', 2, 0.5, 2000).allowed).toBe(true);
    expect(limiter.take('b', 2, 0.5, 0).allowed).toBe(true);
  });
});
