import { describe, it, expect } from 'vitest';
import { InMemoryStore } from '../scripts/hashtreeStore';
import { ProfileSearchIndex } from '../scripts/profileSearchIndex';

describe('ProfileSearchIndex', () => {
  it('indexes and searches by name, nip05, and pubkey', async () => {
    const store = new InMemoryStore();
    const index = new ProfileSearchIndex(store);
    let root = null;

    root = await index.indexProfile(root, {
      pubKey: 'pubkey-1',
      name: 'Alice Wonderland',
      nip05: 'alice@example.com',
    });

    const byName = await index.search(root, 'alice');
    expect(byName.map(result => result.id)).toEqual(['pubkey-1']);

    const byNip05 = await index.search(root, 'example');
    expect(byNip05.map(result => result.id)).toEqual(['pubkey-1']);

    const byPubKey = await index.search(root, 'pubkey-1');
    expect(byPubKey.map(result => result.id)).toEqual(['pubkey-1']);
  });

  it('removes old terms when a profile changes', async () => {
    const store = new InMemoryStore();
    const index = new ProfileSearchIndex(store);
    let root = null;

    const original = {
      pubKey: 'pubkey-2',
      name: 'Alice',
    };
    const updated = {
      pubKey: 'pubkey-2',
      name: 'Bob',
    };

    root = await index.indexProfile(root, original);
    root = await index.updateProfile(root, original, updated);

    const oldResults = await index.search(root, 'alice', { fullMatch: true });
    expect(oldResults).toHaveLength(0);

    const newResults = await index.search(root, 'bob', { fullMatch: true });
    expect(newResults.map(result => result.id)).toEqual(['pubkey-2']);
  });
});
