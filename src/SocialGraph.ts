import { SerializedUniqueIds, UID, UniqueIds } from './UniqueIds';
import { pubKeyRegex, NostrEvent } from './utils';
import * as Binary from './SocialGraphBinary';

export type SerializedUserList = [number, number[], number?]

export type SerializedSocialGraph = {
  uniqueIds: SerializedUniqueIds;
  followLists: SerializedUserList[];
  muteLists?: SerializedUserList[];
};

export class SocialGraph {
  private root: number;
  private recalculatingPromise = null as Promise<void> | null;
  private followDistanceByUser = new Map<number, number>();
  private usersByFollowDistance = new Map<number, Set<number>>();
  // For memory efficiency we allow each follow list to be either a Set<number>
  // (for graphs that are being actively mutated) or a plain number[] (for
  // large, mostly-read-only graphs that are loaded from disk). Arrays are far
  // more memory-efficient than JS Sets.
  private followedByUser = new Map<number, Set<number>>();
  private followersByUser = new Map<number, Set<number>>();
  private followListCreatedAt = new Map<number, number>();
  private mutedByUser = new Map<number, Set<number>>();
  private userMutedBy = new Map<number, Set<number>>();
  private muteListCreatedAt = new Map<number, number>()
  private ids = new UniqueIds();
  private isRecalculating = false;

  constructor(root: string, serialized?: SerializedSocialGraph) {
    this.ids = new UniqueIds(serialized && serialized.uniqueIds);
    this.root = this.id(root);
    this.followDistanceByUser.set(this.root, 0);
    this.usersByFollowDistance.set(0, new Set([this.root]));
    serialized && this.deserialize(serialized);
  }

  private id(str: string): number {
    return this.ids.id(str);
  }

  private str(id: number): string {
    return this.ids.str(id);
  }

  getRoot() {
    return this.str(this.root)
  }

  setRoot(root: string): Promise<void> {
    const rootId = this.id(root);
    if (rootId === this.root) {
      return Promise.resolve();
    }

    this.root = rootId;

    // If a recalculation is already in progress, queue another one to run
    // afterwards so that follow distances are recomputed for the new root.
    if (this.isRecalculating && this.recalculatingPromise) {
      return this.recalculatingPromise.then(() => this.recalculateFollowDistances());
    }

    // No ongoing recalculation, start one immediately.
    return this.recalculateFollowDistances();
  }

  // REPLACE your existing toJsonChunks(...) with this
async *toJsonChunks(maxNodes?: number, maxEdges?: number, maxDistance?: number, maxEdgesPerNode?: number): AsyncGenerator<string | Buffer> {
  // Budget plan
  const {
    usedIds,
    followEdgeCount,
    muteEdgeCount,
    followOwners,
    muteOwners,
  } = this.planBudget(maxNodes, maxEdges, maxDistance, maxEdgesPerNode);

  // Open object and followLists
  yield '{"followLists":[';

  let firstOwner = true;
  for (const owner of followOwners) {
    const ts = this.followListCreatedAt.get(owner) ?? 0;
    const limit = followEdgeCount.get(owner)!;
    let emitted = 0;

    if (!firstOwner) yield ',';
    firstOwner = false;

    // open chunk
    yield `[${owner},[`;

    let firstId = true;
    for (const target of this.followedByUser.get(owner) || []) {
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
    const ts = this.muteListCreatedAt.get(owner) ?? 0;
    const limit = muteEdgeCount.get(owner)!;
    let emitted = 0;

    if (!firstOwner) yield ',';
    firstOwner = false;

    yield `[${owner},[`;

    let firstId = true;
    for (const target of this.mutedByUser.get(owner) || []) {
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
    const pair = JSON.stringify([this.str(id), id]);
    if (!firstUid) yield ',';
    firstUid = false;
    yield pair;
  }
  yield ']}';
}


  recalculateFollowDistances(
    batchSize = 1_000,
    logEvery = 100_000,
    logger: (msg: string) => void = console.log
  ): Promise<void> {
    if (this.isRecalculating) {
      // Already computing – run again afterwards.
      return this.recalculatingPromise!.then(() => this.recalculateFollowDistances(batchSize, logEvery, logger));
    }

    this.isRecalculating = true;
    this.recalculatingPromise = new Promise((resolve) => {
      // Fast local refs
      const root = this.root;
      const followDistanceByUser = this.followDistanceByUser;
      const usersByFollowDistance = this.usersByFollowDistance;
      const followedByUser = this.followedByUser;
  
      // Reset
      followDistanceByUser.clear();
      usersByFollowDistance.clear();
      followDistanceByUser.set(root, 0);
      usersByFollowDistance.set(0, new Set([root]));
  
      const queue: number[] = [root];
      let head = 0;
      let processed = 0;
  
      const start = performance.now?.() ?? Date.now();
      logger(`recalculateFollowDistances: start (batchSize=${batchSize})`);
  
      const pump = () => {
        const end = Math.min(head + batchSize, queue.length);
  
        for (; head < end; head++) {
          const u = queue[head];
          const d = followDistanceByUser.get(u)!;
          const outs = followedByUser.get(u);
          if (!outs) continue;
  
          const nd = d + 1;
          for (const v of outs) {
            if (!followDistanceByUser.has(v)) {
              followDistanceByUser.set(v, nd);
  
              let bucket = usersByFollowDistance.get(nd);
              if (!bucket) {
                bucket = new Set<number>();
                usersByFollowDistance.set(nd, bucket);
              }
              bucket.add(v);
  
              queue.push(v);
            }
          }
        }
  
        processed = head;
  
        if (processed > 0 && (processed % logEvery) < batchSize) {
          logger(
            `recalculateFollowDistances: ${processed} processed, ${queue.length - head} remaining`
          );
        }
  
        if (head < queue.length) {
          setTimeout(pump, 0);
        } else {
          const dur = (performance.now?.() ?? Date.now()) - start;
          logger(`recalculateFollowDistances: done (${processed} users) in ${dur.toFixed(1)}ms`);
          // Mark recalculation as finished so that future calls can start a new one
          this.isRecalculating = false;
          this.recalculatingPromise = null;
          resolve();
        }
      };
  
      // Kick off first chunk synchronously
      pump();
    });
    return this.recalculatingPromise;
  }  

  handleEvent(evs: NostrEvent | Array<NostrEvent>) {
    const filtered = (Array.isArray(evs) ? evs : [evs]).filter((a) => [3, 10000].includes(a.kind));
    for (const event of filtered) {
        const createdAt = event.created_at;
        if (createdAt > Math.floor(Date.now() / 1000) + 10 * 60) {
            console.debug("event.created_at more than 10 minutes in the future", event)
            continue
        }
        const author = this.id(event.pubkey);

        if (event.kind === 3) {
            this.handleFollowList(event, author, createdAt);
        } else if (event.kind === 10000) {
            this.handleMuteList(event, author, createdAt);
        }
    }
  }

  private handleFollowList(event: NostrEvent, author: number, createdAt: number) {
    const existingCreatedAt = this.followListCreatedAt.get(author);
    if (existingCreatedAt && createdAt <= existingCreatedAt) {
        return;
    }
    this.followListCreatedAt.set(author, createdAt);

    const followedInEvent = new Set<number>();
    for (const tag of event.tags) {
        if (tag[0] === 'p') {
            if (!pubKeyRegex.test(tag[1])) {
                continue;
            }
            const followedUser = this.id(tag[1]);
            if (followedUser !== author) {
                followedInEvent.add(followedUser);
            }
        }
    }

    const currentlyFollowed = this.followedByUser.get(author) || new Set<number>();

    for (const user of currentlyFollowed) {
        if (!followedInEvent.has(user)) {
            this.privateRemoveFollower(user, author);
        }
    }

    for (const user of followedInEvent) {
        this.privateAddFollower(user, author);
    }
  }

  private handleMuteList(event: NostrEvent, author: number, createdAt: number) {
    const existingCreatedAt = this.muteListCreatedAt.get(author);
    if (existingCreatedAt && createdAt <= existingCreatedAt) {
        return;
    }
    this.muteListCreatedAt.set(author, createdAt);

    const mutedInEvent = new Set<number>();
    for (const tag of event.tags) {
        if (tag[0] === 'p') {
            if (!pubKeyRegex.test(tag[1])) {
                continue;
            }
            const mutedUser = this.id(tag[1]);
            if (mutedUser !== author) {
                mutedInEvent.add(mutedUser);
            }
        }
    }

    const currentlyMuted = this.mutedByUser.get(author) || new Set<number>();

    for (const user of currentlyMuted) {
        if (!mutedInEvent.has(user)) {
            this.mutedByUser.get(author)?.delete(user);
            this.userMutedBy.get(user)?.delete(author);
        }
    }

    for (const user of mutedInEvent) {
        if (!this.mutedByUser.has(author)) {
            this.mutedByUser.set(author, new Set<number>());
        }
        this.mutedByUser.get(author)?.add(user);

        if (!this.userMutedBy.has(user)) {
            this.userMutedBy.set(user, new Set<number>());
          }
        this.userMutedBy.get(user)?.add(author);
    }
  }

  isFollowing(follower: string, followedUser: string): boolean {
    const followedUserId = this.id(followedUser);
    const followerId = this.id(follower);
    return !!this.followedByUser.get(followerId)?.has(followedUserId);
  }

  getFollowDistance(user: string): number {
    const distance = this.followDistanceByUser.get(this.id(user));
    return distance === undefined ? 1000 : distance;
  }

  private addUserByFollowDistance(distance: number, user: number) {
    if (!this.usersByFollowDistance.has(distance)) {
      this.usersByFollowDistance.set(distance, new Set());
    }
    this.usersByFollowDistance.get(distance)?.add(user);
    for (const d of this.usersByFollowDistance.keys()) {
      if (d > distance) {
        this.usersByFollowDistance.get(d)?.delete(user);
      }
    }
  }

  private privateAddFollower(followedUser: number, follower: number) {
    if (typeof followedUser !== 'number' || typeof follower !== 'number') {
      throw new Error('Invalid user id');
    }
    // Avoid eagerly creating the reverse followers index for every user – it's
    // extremely memory-hungry for large graphs. We only update it when the
    // index already exists (i.e. some consumer has explicitly requested it
    // and the set was created earlier).
    const cachedFollowers = this.followersByUser.get(followedUser);
    if (cachedFollowers) {
      cachedFollowers.add(follower);
    }

    if (!this.followedByUser.has(follower)) {
      this.followedByUser.set(follower, new Set<number>());
    }
    this.followedByUser.get(follower)!.add(followedUser);

    if (followedUser !== this.root) {
      let newFollowDistance;
      if (follower === this.root) {
        newFollowDistance = 1;
        this.addUserByFollowDistance(newFollowDistance, followedUser);
        this.followDistanceByUser.set(followedUser, newFollowDistance);
      } else {
        const existingFollowDistance = this.followDistanceByUser.get(followedUser);
        const followerDistance = this.followDistanceByUser.get(follower);
        newFollowDistance = followerDistance && followerDistance + 1;
        if (
          existingFollowDistance === undefined ||
          (newFollowDistance && newFollowDistance < existingFollowDistance)
        ) {
          this.followDistanceByUser.set(followedUser, newFollowDistance!);
          this.addUserByFollowDistance(newFollowDistance!, followedUser);
        }
      }
    }
  }

  addFollower(follower: string, followedUser: string) {
    this.privateAddFollower(this.id(followedUser), this.id(follower))
  }

  removeFollower(follower: string, followedUser: string) {
    this.privateRemoveFollower(this.id(followedUser), this.id(follower))
  }

  private privateRemoveFollower(unfollowedUser: number, follower: number) {
    this.followersByUser.get(unfollowedUser)?.delete(follower);
    this.followedByUser.get(follower)?.delete(unfollowedUser);

    if (unfollowedUser === this.root) {
      return;
    }

    let smallest = Infinity;
    for (const follower of this.getFollowersSet(unfollowedUser)) {
      const followerDistance = this.followDistanceByUser.get(follower);
      if (followerDistance !== undefined && followerDistance + 1 < smallest) {
        smallest = followerDistance + 1;
      }
    }

    if (smallest === Infinity) {
      this.followDistanceByUser.delete(unfollowedUser);
    } else {
      this.followDistanceByUser.set(unfollowedUser, smallest);
    }
  }

  followerCount(address: string) {
    const id = this.id(address);
    return this.getFollowersSet(id).size;
  }

  followedByFriendsCount(address: string) {
    let count = 0;
    const id = this.id(address);
    for (const follower of this.getFollowersSet(id)) {
      if (this.followedByUser.get(this.root)?.has(follower)) {
        count++;
      }
    }
    return count;
  }

  mutedByFriendsCount(address: string) {
    let count = 0;
    const id = this.id(address);
    for (const muter of this.userMutedBy.get(id) ?? []) {
      if (this.followedByUser.get(this.root)?.has(muter)) {
        count++;
      }
    }
    return count;
  }

  size() {
    let follows = 0;
    let mutes = 0;
    const sizeByDistance: { [distance: number]: number } = {};

    for (const followedSet of this.followedByUser.values()) {
      follows += followedSet.size;
    }

    for (const mutedSet of this.mutedByUser.values()) {
      mutes += mutedSet.size;
    }

    for (const [distance, users] of this.usersByFollowDistance.entries()) {
      sizeByDistance[distance] = users.size;
    }

    // If follow distances haven't been calculated (e.g. when we deliberately
    // skip them for memory reasons), fall back to counting the unique IDs we
    // know about.
    const usersCount = this.followDistanceByUser.size || (this.ids as any).uniqueIdToStr?.size || 0;

    return {
      users: usersCount,
      follows,
      mutes,
      sizeByDistance,
    };
  }

  followedByFriends(address: string) {
    const id = this.id(address);
    const set = new Set<string>();
    for (const follower of this.getFollowersSet(id)) {
      if (this.followedByUser.get(this.root)?.has(follower)) {
        set.add(this.str(follower));
      }
    }
    return set;
  }

  getFollowedByUser(user: string, includeSelf = false): Set<string> {
    const userId = this.id(user);
    const set = new Set<string>();
    for (const id of this.followedByUser.get(userId) || []) {
      set.add(this.str(id));
    }
    if (includeSelf) {
      set.add(user);
    }
    return set;
  }

  getFollowersByUser(address: string): Set<string> {
    const userId = this.id(address);
    const set = new Set<string>();
    for (const id of this.getFollowersSet(userId)) {
      set.add(this.str(id));
    }
    return set;
  }

  serialize(maxBytes?: number): Promise<SerializedSocialGraph> {
    // Fast path when no size limit is set
    if (!maxBytes) {
      return this.serializeWithoutSizeLimit();
    }
    
    // Size-aware path when maxBytes is set
    return this.serializeWithSizeLimit(maxBytes);
  }

  private serializeWithoutSizeLimit(): Promise<SerializedSocialGraph> {
    return new Promise((resolve) => {
      const followLists: SerializedUserList[] = [];
      const muteLists: SerializedUserList[] = [];
      const usedIds = new Set<number>();

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
      for (const [user] of this.followedByUser) {
        allUsers.add(user);
      }
      for (const [user] of this.mutedByUser) {
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
          const followedUsers = this.followedByUser.get(user);
          const followListCreatedAt = this.followListCreatedAt.get(user);
          if (followedUsers && followListCreatedAt) {
            addListChunk(user, Array.from(followedUsers), followListCreatedAt, true);
          }

          // Process mute list if available
          const mutedUsers = this.mutedByUser.get(user);
          const muteListCreatedAt = this.muteListCreatedAt.get(user);
          if (mutedUsers && muteListCreatedAt) {
            addListChunk(user, Array.from(mutedUsers), muteListCreatedAt, false);
          }
        }

        processedCount = end;

        if (processedCount < users.length) {
          setTimeout(pump, 0);
        } else {
          // All users processed
          resolve({
            followLists,
            uniqueIds: this.ids.serialize(usedIds),
            muteLists,
          });
        }
      };

      // Kick off processing
      setTimeout(pump, 0);
    });
  }

  private serializeWithSizeLimit(maxBytes: number): Promise<SerializedSocialGraph> {
    return new Promise((resolve) => {
      const followLists: SerializedUserList[] = [];
      const muteLists: SerializedUserList[] = [];
      const usedIds = new Set<number>();

      // Calculate UTF-8 byte length of a positive integer
      const digitLength = (n: number) => n === 0 ? 1 : Math.floor(Math.log10(n)) + 1;

      // Calculate size for one unique ID entry: ["hex64",id]
      const uidEntrySize = (id: number) => {
        const hexString = this.str(id);
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
      for (const [user] of this.followedByUser) {
        allUsers.add(user);
      }
      for (const [user] of this.mutedByUser) {
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
          const followedUsers = this.followedByUser.get(user);
          const followListCreatedAt = this.followListCreatedAt.get(user);
          if (followedUsers && followListCreatedAt) {
            addListChunk(user, Array.from(followedUsers), followListCreatedAt, true);
          }

          // Process mute list if available
          const mutedUsers = this.mutedByUser.get(user);
          const muteListCreatedAt = this.muteListCreatedAt.get(user);
          if (mutedUsers && muteListCreatedAt) {
            addListChunk(user, Array.from(mutedUsers), muteListCreatedAt, false);
          }
        }

        processedCount = end;

        if (processedCount < users.length) {
          setTimeout(pump, 0);
        } else {
          // All users processed
          resolve({
            followLists,
            uniqueIds: this.ids.serialize(usedIds),
            muteLists,
          });
        }
      };

      // Kick off processing
      setTimeout(pump, 0);
    });
  }

  private deserialize(serialized: SerializedSocialGraph): void {
    const { followLists, muteLists } = serialized;
    const serializedRoot = followLists[0]?.[0];
    for (const [follower, followedUsers, createdAt] of followLists) {
      for (const followedUser of followedUsers) {
        this.privateAddFollower(followedUser, follower);
      }
      this.followListCreatedAt.set(follower, createdAt ?? 0);
    }
    if (muteLists) {
      for (const [muter, mutedUsers, createdAt] of muteLists) {
        this.mutedByUser.set(muter, new Set(mutedUsers));
        for (const mutedUser of mutedUsers) {
          if (!this.userMutedBy.has(mutedUser)) {
            this.userMutedBy.set(mutedUser, new Set());
          }
          this.userMutedBy.get(mutedUser)?.add(muter);
        }
        this.muteListCreatedAt.set(muter, createdAt ?? 0);
      }
    }
    if (serializedRoot !== this.root) {
      // Fire and forget - we don't need to wait for this in deserialization
      this.recalculateFollowDistances().catch(console.error);
    }
  }

  getUsersByFollowDistance(distance: number): Set<string> {
    const users = this.usersByFollowDistance.get(distance) || new Set<number>();
    const result = new Set<string>();
    for (const user of users) {
      result.add(this.str(user));
    }
    return result;
  }

  getFollowListCreatedAt(user: string) {
    return this.followListCreatedAt.get(this.id(user))
  }

  merge(other: SocialGraph): Promise<void> {
    return new Promise((resolve) => {
      console.log('size before merge', this.size());
      console.time('merge graph');
      
      const users = Array.from(other);
      let processedCount = 0;

      const processNextUser = () => {
        if (processedCount >= users.length) {
          // All users processed, now recalculate distances
          this.recalculateFollowDistances().then(() => {
            console.timeEnd('merge graph');
            console.log('size after merge', this.size());
            resolve();
          });
          return;
        }

        const user = users[processedCount];
        
        this.mergeUserLists(
          user,
          this.followListCreatedAt,
          other.followListCreatedAt,
          this.followedByUser,
          other.followedByUser
        );

        this.mergeUserLists(
          user,
          this.muteListCreatedAt,
          other.muteListCreatedAt,
          this.mutedByUser,
          other.mutedByUser
        );
        
        processedCount++;

        // Schedule next user processing
        setTimeout(processNextUser, 0);
      };

      // Start processing
      setTimeout(processNextUser, 0);
    });
  }

  // ADD THIS HELPER INSIDE THE CLASS (private)
private planBudget(maxNodes?: number, maxEdges?: number, maxDistance?: number, maxEdgesPerNode?: number) {
  const usedIds = new Set<number>();
  const followEdgeCount = new Map<number, number>();
  const muteEdgeCount   = new Map<number, number>();

  let edges = 0;

  const canAddNode = (id: number) =>
    usedIds.has(id) || !maxNodes || usedIds.size < maxNodes;

  const addEdge = (owner: number, target: number, isFollow: boolean) => {
    if (maxEdges && edges >= maxEdges) return false;
    if (!canAddNode(owner)) return false;
    if (!canAddNode(target)) {
      // node budget full, but we can still add edge if both nodes already included
      if (!usedIds.has(owner) || !usedIds.has(target)) return false;
    }

    // Check per-node edge limit
    if (maxEdgesPerNode) {
      const currentFollowEdges = followEdgeCount.get(owner) ?? 0;
      const currentMuteEdges = muteEdgeCount.get(owner) ?? 0;
      const totalOwnerEdges = currentFollowEdges + currentMuteEdges;
      if (totalOwnerEdges >= maxEdgesPerNode) return false;
    }

    // ensure nodes accounted
    usedIds.add(owner);
    usedIds.add(target);

    // count edge
    edges++;
    const map = isFollow ? followEdgeCount : muteEdgeCount;
    map.set(owner, (map.get(owner) ?? 0) + 1);
    return true;
  };

  const allDistances = Array.from(this.usersByFollowDistance.keys()).sort((a, b) => a - b);
  // Filter distances by maxDistance if specified
  const distances = maxDistance !== undefined 
    ? allDistances.filter(d => d <= maxDistance)
    : allDistances;

  outer: for (const d of distances) {
    const users = this.usersByFollowDistance.get(d);
    if (!users) continue;
    for (const owner of users) {
      const outsF = this.followedByUser.get(owner);
      if (outsF) {
        for (const t of outsF) {
          if (!addEdge(owner, t, true)) {
            if (maxEdges && edges >= maxEdges) break outer;
          }
        }
      }
      const outsM = this.mutedByUser.get(owner);
      if (outsM) {
        for (const t of outsM) {
          if (!addEdge(owner, t, false)) {
            if (maxEdges && edges >= maxEdges) break outer;
          }
        }
      }
    }
  }

  // owners we actually kept
  const followOwners = Array.from(followEdgeCount.keys());
  const muteOwners   = Array.from(muteEdgeCount.keys());

  return {
    usedIds,
    followEdgeCount,
    muteEdgeCount,
    followOwners,
    muteOwners,
  };
}


  private mergeUserLists(
    user: string,
    ourCreatedAtMap: Map<number, number>,
    theirCreatedAtMap: Map<number, number>,
    ourUserMap: Map<number, Set<number>>, 
    theirUserMap: Map<number, Set<number>>
  ) {
    const userId = this.id(user);
    const ourCreatedAt = ourCreatedAtMap.get(userId);
    const theirCreatedAt = theirCreatedAtMap.get(userId);

    if (!ourCreatedAt || (theirCreatedAt && ourCreatedAt < theirCreatedAt)) {
      const newUsers = theirUserMap.get(userId) || new Set<number>();
      const currentUsers = ourUserMap.get(userId) || new Set<number>();

      for (const newUser of newUsers) {
        if (!currentUsers.has(newUser)) {
          if (!ourUserMap.has(userId)) {
            ourUserMap.set(userId, new Set<number>());
          }
          ourUserMap.get(userId)!.add(newUser);
        }
      }

      for (const currentUser of currentUsers) {
        if (!newUsers.has(currentUser)) {
          ourUserMap.get(userId)!.delete(currentUser);
        }
      }

      ourCreatedAtMap.set(userId, theirCreatedAt ?? 0);
    }
  }

  *userIterator(upToDistance?: number): Generator<string> {
    const distances = Array.from(this.usersByFollowDistance.keys()).sort((a, b) => a - b);
    for (const distance of distances) {
      if (upToDistance !== undefined && distance > upToDistance) {
        break;
      }
      const users = this.usersByFollowDistance.get(distance) || new Set<number>();
      for (const user of users) {
        yield this.str(user);
      }
    }
  }

  [Symbol.iterator](): Generator<string> {
    return this.userIterator();
  }

  getMutedByUser(user: string): Set<string> {
    const userId = this.id(user);
    const set = new Set<string>();
    for (const id of this.mutedByUser.get(userId) || []) {
      set.add(this.str(id));
    }
    return set;
  }

  getUserMutedBy(user: string): Set<string> {
    const userId = this.id(user);
    const set = new Set<string>();
    for (const id of this.userMutedBy.get(userId) || []) {
      set.add(this.str(id));
    }
    return set;
  }

  // follower and muter counts by distance
  stats(user: string): { [distance: number]: { followers: number; muters: number } } {
    const stats: { [distance: number]: { followers: number; muters: number } } = {};
    const userId = this.id(user);
    for (const follower of this.getFollowersSet(userId)) {
      const distance = this.followDistanceByUser.get(follower);
      if (distance !== undefined) {
        if (!stats[distance]) {
          stats[distance] = { followers: 0, muters: 0 };
        }
        stats[distance].followers++;
      }
    }
    for (const muter of this.userMutedBy.get(userId) || []) {
      const distance = this.followDistanceByUser.get(muter);
      if (distance !== undefined) {
        if (!stats[distance]) {
          stats[distance] = { followers: 0, muters: 0 };
        }
        stats[distance].muters++;
      }
    }
    return stats;
  }

  /**
   * Remove users who are muted by someone AND have zero followers.
   * O(E + M) where E = follows edges, M = mutes edges.
   * TODO: this is still blocking / not performant
   */
  removeMutedNotFollowedUsers(
    batchSize = 50_000,
    logger: (scanned: number, removed: number) => void = () => {}
  ): number {
    // 1) Build follower counts once if we don't have followersByUser cached.
    const followerCount = new Map<number, number>();
    for (const [, outs] of this.followedByUser) {
      for (const u of outs) {
        followerCount.set(u, (followerCount.get(u) ?? 0) + 1);
      }
    }

    // 2) Scan muted users; collect those with zero followers.
    const usersToRemove: number[] = [];
    let scanned = 0;

    for (const [user, muters] of this.userMutedBy) {
      scanned++;
      if (muters.size > 0 && (followerCount.get(user) ?? 0) === 0) {
        usersToRemove.push(user);
      }
      if (scanned % batchSize === 0) logger(scanned, usersToRemove.length);
    }

    // 3) Remove them.
    for (const id of usersToRemove) this.removeUserById(id);

    logger(scanned, usersToRemove.length);
    return usersToRemove.length;
  }

  private removeUserById(user: UID) {
    // Remove from UniqueIds
    this.ids.remove(user);

    // Remove from all maps
    this.followDistanceByUser.delete(user);
    this.followedByUser.delete(user);
    this.followersByUser.delete(user);
    this.followListCreatedAt.delete(user);
    this.mutedByUser.delete(user);
    this.userMutedBy.delete(user);
    this.muteListCreatedAt.delete(user);

    // Remove user from all sets
    this.usersByFollowDistance.forEach(set => set.delete(user));
    this.followedByUser.forEach(set => set.delete(user));
    this.followersByUser.forEach(set => set.delete(user));
    this.mutedByUser.forEach(set => set.delete(user));
    this.userMutedBy.forEach(set => set.delete(user));
  }

  toBinaryChunks(maxNodes?: number, maxEdges?: number, maxDistance?: number, maxEdgesPerNode?: number): AsyncGenerator<Uint8Array> {
    return Binary.toBinaryChunks(this, maxNodes, maxEdges, maxDistance, maxEdgesPerNode);
  }

  toBinary(maxNodes?: number, maxEdges?: number, maxDistance?: number, maxEdgesPerNode?: number): Promise<Uint8Array> {
    return Binary.toBinary(this, maxNodes, maxEdges, maxDistance, maxEdgesPerNode);
  }

  static fromBinary(root: string, data: Uint8Array): Promise<SocialGraph> {
    return Binary.fromBinary(root, data);
  }

  static fromBinaryStream(root: string, stream: ReadableStream<Uint8Array>): Promise<SocialGraph> {
    return Binary.fromBinaryStream(root, stream);
  }

  private getFollowersSet(id: number): Set<number> {
    // Prefer the cached value when it exists (small graphs / earlier versions)
    const cached = this.followersByUser.get(id);
    if (cached) {
      return cached;
    }
    // Compute followers by walking the outgoing follow lists.
    const computed = new Set<number>();
    for (const [follower, followed] of this.followedByUser) {
      if (followed.has(id)) {
        computed.add(follower);
      }
    }
    return computed;
  }

  // helper removed – all follow lists are stored as Sets again for simplicity
}
