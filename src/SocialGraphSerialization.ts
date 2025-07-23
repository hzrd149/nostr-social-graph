import { SocialGraph, SerializedSocialGraph, SerializedUserList } from './SocialGraph';

/**
 * JSON serialization methods for SocialGraph
 */
export class SocialGraphSerialization {

  // Budget planning method for serialization
  static planBudget(
    graph: SocialGraph,
    maxNodes?: number, 
    maxEdges?: number, 
    maxDistance?: number, 
    maxEdgesPerNode?: number
  ) {
    const usedIds = new Set<number>();
    const followEdgeCount = new Map<number, number>();
    const muteEdgeCount = new Map<number, number>();
    const validEdges: Array<{owner: number, target: number, isFollow: boolean}> = [];

    const { followedByUser, mutedByUser } = graph.getInternalData();
    const usersByFollowDistance = (graph as any).usersByFollowDistance as Map<number, Set<number>>;

    const allDistances = Array.from(usersByFollowDistance.keys()).sort((a: number, b: number) => a - b);
    // Filter distances by maxDistance if specified
    const distances = maxDistance !== undefined 
      ? allDistances.filter((d: number) => d <= maxDistance)
      : allDistances;

    // Collect all potential edges first, respecting distance and per-node limits
    const potentialEdges: Array<{owner: number, target: number, isFollow: boolean, distance: number}> = [];
    
    for (const d of distances) {
      const users = usersByFollowDistance.get(d);
      if (!users) continue;
      
      for (const owner of users) {
        let ownerEdgeCount = 0;
        
        // Collect follow edges for this owner
        const outsF = followedByUser.get(owner);
        if (outsF) {
          for (const target of outsF) {
            if (!maxEdgesPerNode || ownerEdgeCount < maxEdgesPerNode) {
              potentialEdges.push({owner, target, isFollow: true, distance: d});
              ownerEdgeCount++;
            }
          }
        }
        
        // Collect mute edges for this owner
        const outsM = mutedByUser.get(owner);
        if (outsM) {
          for (const target of outsM) {
            if (!maxEdgesPerNode || ownerEdgeCount < maxEdgesPerNode) {
              potentialEdges.push({owner, target, isFollow: false, distance: d});
              ownerEdgeCount++;
            }
          }
        }
      }
    }

    // Now process edges in distance order, checking both node and edge limits
    let edgeCount = 0;
    const { str } = graph.getInternalData();
    
    for (const edge of potentialEdges) {
      // Check edge limit
      if (maxEdges && edgeCount >= maxEdges) break;
      
      // Validate that both owner and target actually exist in the UniqueIds mapping
      try {
        str(edge.owner);
        str(edge.target);
      } catch (error) {
        // Skip edges that reference non-existent IDs
        console.warn(`Skipping edge with invalid ID: owner=${edge.owner}, target=${edge.target}`);
        continue;
      }
      
      // Check if we can add both nodes
      const ownerCanBeAdded = usedIds.has(edge.owner) || !maxNodes || usedIds.size < maxNodes;
      const targetCanBeAdded = usedIds.has(edge.target) || !maxNodes || usedIds.size < maxNodes;
      
      if (!ownerCanBeAdded || !targetCanBeAdded) {
        // If we can't add either node due to node limit, skip this edge
        continue;
      }
      
      // Add the edge
      validEdges.push(edge);
      usedIds.add(edge.owner);
      usedIds.add(edge.target);
      edgeCount++;
      
      // Update edge counts per owner
      const map = edge.isFollow ? followEdgeCount : muteEdgeCount;
      map.set(edge.owner, (map.get(edge.owner) ?? 0) + 1);
    }

    // owners we actually kept
    const followOwners = Array.from(followEdgeCount.keys());
    const muteOwners = Array.from(muteEdgeCount.keys());

    return {
      usedIds,
      followEdgeCount,
      muteEdgeCount,
      followOwners,
      muteOwners,
    };
  }
  
  static async *toJsonChunks(
    graph: SocialGraph, 
    maxNodes?: number, 
    maxEdges?: number, 
    maxDistance?: number, 
    maxEdgesPerNode?: number
  ): AsyncGenerator<string | Buffer> {
    // Budget plan
    const {
      usedIds,
      followEdgeCount,
      muteEdgeCount,
      followOwners,
      muteOwners,
    } = SocialGraphSerialization.planBudget(graph, maxNodes, maxEdges, maxDistance, maxEdgesPerNode);

    const { followedByUser, mutedByUser, followListCreatedAt, muteListCreatedAt, str } = graph.getInternalData();

    // Open object and followLists
    yield '{"followLists":[';

    let firstOwner = true;
    for (const owner of followOwners) {
      const ts = followListCreatedAt.get(owner) ?? 0;
      const limit = followEdgeCount.get(owner)!;
      let emitted = 0;

      if (!firstOwner) yield ',';
      firstOwner = false;

      // open chunk
      yield `[${owner},[`;

      let firstId = true;
      for (const target of followedByUser.get(owner) || []) {
        if (emitted >= limit) break;
        if (!firstId) yield ',';
        firstId = false;
        yield String(target);
        emitted++;
      }

      yield `],${ts}]`;
    }

    // muteLists
    yield '],"muteLists":[';

    firstOwner = true;
    for (const owner of muteOwners) {
      const ts = muteListCreatedAt.get(owner) ?? 0;
      const limit = muteEdgeCount.get(owner)!;
      let emitted = 0;

      if (!firstOwner) yield ',';
      firstOwner = false;

      yield `[${owner},[`;

      let firstId = true;
      for (const target of mutedByUser.get(owner) || []) {
        if (emitted >= limit) break;
        if (!firstId) yield ',';
        firstId = false;
        yield String(target);
        emitted++;
      }

      yield `],${ts}]`;
    }

    // uniqueIds
    yield '],"uniqueIds":[';
    let firstUid = true;
    for (const id of usedIds) {
      try {
        const pair = JSON.stringify([str(id), id]);
        if (!firstUid) yield ',';
        firstUid = false;
        yield pair;
      } catch (error) {
        console.warn(`Skipping invalid ID ${id}: ${error instanceof Error ? error.message : String(error)}`);
        // Skip this ID and continue
      }
    }
    yield ']}';
  }

  static serialize(graph: SocialGraph, maxBytes?: number): Promise<SerializedSocialGraph> {
    // Fast path when no size limit is set
    if (!maxBytes) {
      return SocialGraphSerialization.serializeWithoutSizeLimit(graph);
    }
    
    // Size-aware path when maxBytes is set
    return SocialGraphSerialization.serializeWithSizeLimit(graph, maxBytes);
  }

  private static serializeWithoutSizeLimit(graph: SocialGraph): Promise<SerializedSocialGraph> {
    return new Promise((resolve) => {
      const followLists: SerializedUserList[] = [];
      const muteLists: SerializedUserList[] = [];
      const usedIds = new Set<number>();

      const { followedByUser, mutedByUser, followListCreatedAt, muteListCreatedAt, ids } = graph.getInternalData();

      const addUserToUsedIds = (id: number) => {
        if (!usedIds.has(id)) {
          usedIds.add(id);
        }
      };

      const addListChunk = (user: number, ids: number[], createdAt: number, isFollowList: boolean) => {
        if (ids.length === 0) return;
        
        addUserToUsedIds(user);
        ids.forEach(addUserToUsedIds);
        
        if (isFollowList) {
          followLists.push([user, ids, createdAt]);
        } else {
          muteLists.push([user, ids, createdAt]);
        }
      };

      // Combine all users that have either follow or mute lists
      const allUsers = new Set<number>();
      for (const [user] of followedByUser) {
        allUsers.add(user);
      }
      for (const [user] of mutedByUser) {
        allUsers.add(user);
      }

      const users = Array.from(allUsers);
      let processedCount = 0;

      const BATCH_SIZE = 10_000; // tune if needed

      const pump = () => {
        const end = Math.min(processedCount + BATCH_SIZE, users.length);

        for (let i = processedCount; i < end; i++) {
          const user = users[i];

          // Process follow list if available
          const followedUsers = followedByUser.get(user);
          const followListCreatedAtValue = followListCreatedAt.get(user);
          if (followedUsers && followListCreatedAtValue) {
            addListChunk(user, Array.from(followedUsers), followListCreatedAtValue, true);
          }

          // Process mute list if available
          const mutedUsers = mutedByUser.get(user);
          const muteListCreatedAtValue = muteListCreatedAt.get(user);
          if (mutedUsers && muteListCreatedAtValue) {
            addListChunk(user, Array.from(mutedUsers), muteListCreatedAtValue, false);
          }
        }

        processedCount = end;

        if (processedCount < users.length) {
          setTimeout(pump, 0);
        } else {
          // All users processed
          resolve({
            followLists,
            uniqueIds: ids.serialize(usedIds),
            muteLists,
          });
        }
      };

      // Kick off processing
      setTimeout(pump, 0);
    });
  }

  private static serializeWithSizeLimit(graph: SocialGraph, maxBytes: number): Promise<SerializedSocialGraph> {
    return new Promise((resolve) => {
      const followLists: SerializedUserList[] = [];
      const muteLists: SerializedUserList[] = [];
      const usedIds = new Set<number>();

      const { followedByUser, mutedByUser, followListCreatedAt, muteListCreatedAt, ids, str } = graph.getInternalData();

      // Calculate UTF-8 byte length of a positive integer
      const digitLength = (n: number) => n === 0 ? 1 : Math.floor(Math.log10(n)) + 1;

      // Calculate size for one unique ID entry: ["hex64",id]
      const uidEntrySize = (id: number) => {
        const hexString = str(id);
        return 2 + // [ and ]
          hexString.length + 2 + // "hex64" (including quotes)
          1 + // comma
          digitLength(id); // id number
      };

      // Calculate size for uniqueIds array structure
      const calculateUniqueIdsSize = (ids: Set<number>) => {
        if (ids.size === 0) return 2; // []
        let size = 2; // [ and ]
        let count = 0;
        for (const id of ids) {
          if (count > 0) size += 1; // comma
          size += uidEntrySize(id);
          count++;
        }
        return size;
      };

      // Calculate size for a list chunk: [user,[id1,id2,...],timestamp]
      const calculateListChunkSize = (user: number, ids: number[], createdAt: number) => {
        let size = 1; // [
        size += digitLength(user) + 1; // user and comma
        size += 1; // [ for nested array
        if (ids.length > 0) {
          size += digitLength(ids[0]); // first id
          for (let i = 1; i < ids.length; i++) {
            size += 1 + digitLength(ids[i]); // comma + id
          }
        }
        size += 1; // ] for nested array
        size += 1; // comma
        size += digitLength(createdAt) + 1; // timestamp and ]
        return size;
      };

      // Fixed outer JSON structure size
      let currentSize = 1 + // {
        '"followLists":'.length + 1 + // :
        '"uniqueIds":'.length + 1 + // :
        '"muteLists":'.length + 1 + // :
        1; // }

      const accountUid = (id: number) => {
        if (usedIds.has(id)) return 0; // no additional size if already accounted for
        usedIds.add(id);
        return 0; // We'll calculate uniqueIds size separately
      };

      const addListChunk = (user: number, ids: number[], createdAt: number, isFollowList: boolean) => {
        /* ensure the owner's id is in uniqueIds BEFORE any size checks */
        accountUid(user);

        // Calculate the size this chunk would add
        const chunkSize = calculateListChunkSize(user, ids, createdAt);
        
        // Calculate the size of uniqueIds if we add this chunk
        const tempUsedIds = new Set(usedIds);
        for (const id of ids) {
          tempUsedIds.add(id);
        }
        const uniqueIdsSize = calculateUniqueIdsSize(tempUsedIds);
        
        // Calculate the total size including all arrays
        const followListsSize = followLists.length === 0 ? 2 : 2 + followLists.reduce((size, chunk) => size + calculateListChunkSize(chunk[0], chunk[1], chunk[2] ?? 0), 0) + (followLists.length - 1);
        const muteListsSize = muteLists.length === 0 ? 2 : 2 + muteLists.reduce((size, chunk) => size + calculateListChunkSize(chunk[0], chunk[1], chunk[2] ?? 0), 0) + (muteLists.length - 1);
        
        // Add the new chunk size
        const newFollowListsSize = isFollowList ? 
          (followListsSize === 2 ? 2 + chunkSize : followListsSize + 1 + chunkSize) :
          followListsSize;
        const newMuteListsSize = !isFollowList ? 
          (muteListsSize === 2 ? 2 + chunkSize : muteListsSize + 1 + chunkSize) :
          muteListsSize;
        
        const totalSize = currentSize + newFollowListsSize + uniqueIdsSize + newMuteListsSize;
        
        if (totalSize > maxBytes) {
          return;
        }

        // Add the chunk
        if (isFollowList) {
          followLists.push([user, ids, createdAt]);
        } else {
          muteLists.push([user, ids, createdAt]);
        }
        
        // Update usedIds
        for (const id of ids) {
          usedIds.add(id);
        }
      };

      // Combine all users that have either follow or mute lists
      const allUsers = new Set<number>();
      for (const [user] of followedByUser) {
        allUsers.add(user);
      }
      for (const [user] of mutedByUser) {
        allUsers.add(user);
      }

      const users = Array.from(allUsers);
      let processedCount = 0;

      const BATCH_SIZE = 10_000; // tune if needed

      const pump = () => {
        const end = Math.min(processedCount + BATCH_SIZE, users.length);

        for (let i = processedCount; i < end; i++) {
          const user = users[i];

          // Process follow list if available
          const followedUsers = followedByUser.get(user);
          const followListCreatedAtValue = followListCreatedAt.get(user);
          if (followedUsers && followListCreatedAtValue) {
            addListChunk(user, Array.from(followedUsers), followListCreatedAtValue, true);
          }

          // Process mute list if available
          const mutedUsers = mutedByUser.get(user);
          const muteListCreatedAtValue = muteListCreatedAt.get(user);
          if (mutedUsers && muteListCreatedAtValue) {
            addListChunk(user, Array.from(mutedUsers), muteListCreatedAtValue, false);
          }
        }

        processedCount = end;

        if (processedCount < users.length) {
          setTimeout(pump, 0);
        } else {
          // All users processed
          resolve({
            followLists,
            uniqueIds: ids.serialize(usedIds),
            muteLists,
          });
        }
      };

      // Kick off processing
      setTimeout(pump, 0);
    });
  }
} 