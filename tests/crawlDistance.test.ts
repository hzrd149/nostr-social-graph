import { describe, it, expect } from 'vitest';
import { parseCrawlDistance } from '../scripts/crawlDistance';

describe('parseCrawlDistance', () => {
  it('returns fallback when input is missing', () => {
    expect(parseCrawlDistance(undefined, 4)).toBe(4);
  });

  it('returns undefined for "all"', () => {
    expect(parseCrawlDistance('all', 4)).toBeUndefined();
  });

  it('parses numeric values', () => {
    expect(parseCrawlDistance('5', 4)).toBe(5);
  });

  it('falls back on invalid values', () => {
    expect(parseCrawlDistance('nope', 4)).toBe(4);
  });
});
