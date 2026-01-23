import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../scripts/hashtreeStore";
import { ProfileSearchIndex, profileSearchIndexNhash } from "../scripts/profileSearchIndex";
import { pushProfileSearchIndex } from "../scripts/publishProfileSearchIndex";

describe("pushProfileSearchIndex", () => {
  it("pushes index blocks to the target store and returns nhash", async () => {
    const sourceStore = new InMemoryStore();
    const targetStore = new InMemoryStore();
    const index = new ProfileSearchIndex(sourceStore);

    let root = null;
    root = await index.indexProfile(root, {
      pubKey: "pubkey-1",
      name: "E2E Test User",
      nip05: "e2e",
    });

    if (!root) {
      throw new Error("Expected profile search index root");
    }

    const result = await pushProfileSearchIndex({
      root,
      sourceStore,
      targetStore,
    });

    expect(result.nhash).toBe(profileSearchIndexNhash(root));
    expect(await targetStore.has(root.hash)).toBe(true);
  });
});
