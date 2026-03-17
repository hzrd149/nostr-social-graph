import { describe, it, expect } from 'vitest';
import { canonicalizeProfile } from '../scripts/profileCanonicalize';

describe('canonicalizeProfile', () => {
  it('extracts names from display_name, name, and username', () => {
    const profile = {
      display_name: 'Wonderland',
      name: 'Alicia Liddell',
      username: 'alice123',
      nip05: 'alice@example.com',
    };

    const result = canonicalizeProfile(profile);

    expect(result.primaryName).toBe('Wonderland');
    expect(result.names).toEqual(['Wonderland', 'Alicia Liddell', 'alice123']);
    expect(result.nip05).toBe('alice');
  });

  it('rejects invalid nip05 local parts', () => {
    const profile = {
      name: 'Test User',
      nip05: 'npub1abcd@example.com',
    };

    const result = canonicalizeProfile(profile);

    expect(result.primaryName).toBe('Test User');
    expect(result.nip05).toBeUndefined();
  });
});
