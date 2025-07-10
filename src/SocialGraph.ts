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
  private followDistanceByUser = new Map<number, number>();
  private usersByFollowDistance = new Map<number, Set<number>>();
  private followedByUser = new Map<number, Set<number>>();
  private followersByUser = new Map<number, Set<number>>();
  private followListCreatedAt = new Map<number, number>();
  private mutedByUser = new Map<number, Set<number>>();
  private userMutedBy = new Map<number, Set<number>>();
  private muteListCreatedAt = new Map<number, number>()
  private ids = new UniqueIds();

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
    return this.recalculateFollowDistances();
  }

  recalculateFollowDistances(): Promise<void> {
    return new Promise((resolve) => {
      this.followDistanceByUser.clear();
      this.usersByFollowDistance.clear();
      this.followDistanceByUser.set(this.root, 0);
      this.usersByFollowDistance.set(0, new Set([this.root]));

      const queue = [this.root];
      const batchSize = 1000; // Process 1000 users per microtask
      let processedCount = 0;

      const processBatch = () => {
        let batchCount = 0;

        while (queue.length > 0 && batchCount < batchSize) {
          const user = queue.shift()!;
          const distance = this.followDistanceByUser.get(user)!;

          const followedUsers = this.followedByUser.get(user) || new Set<number>();
          for (const followed of followedUsers) {
            if (!this.followDistanceByUser.has(followed)) {
              const newFollowDistance = distance + 1;
              this.followDistanceByUser.set(followed, newFollowDistance);
              if (!this.usersByFollowDistance.has(newFollowDistance)) {
                this.usersByFollowDistance.set(newFollowDistance, new Set());
              }
              this.usersByFollowDistance.get(newFollowDistance)!.add(followed);
              queue.push(followed);
            }
          }
          
          batchCount++;
          processedCount++;
        }

        // Log progress every 10,000 users
        if (processedCount % 10000 === 0) {
          console.log(`Recalculating follow distances: ${processedCount} users processed, ${queue.length} remaining`);
        }

        // If we still have work to do, schedule the next batch
        if (queue.length > 0) {
          queueMicrotask(processBatch);
        } else {
          console.log(`Finished recalculating follow distances. Processed ${processedCount} users.`);
          resolve();
        }
      };

      // Start processing
      queueMicrotask(processBatch);
    });
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
    if (!this.followersByUser.has(followedUser)) {
      this.followersByUser.set(followedUser, new Set<number>());
    }
    this.followersByUser.get(followedUser)?.add(follower);

    if (!this.followedByUser.has(follower)) {
      this.followedByUser.set(follower, new Set<number>());
    }

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

    this.followedByUser.get(follower)?.add(followedUser);
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
    for (const follower of this.followersByUser.get(unfollowedUser) || []) {
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
    return this.followersByUser.get(id)?.size ?? 0;
  }

  followedByFriendsCount(address: string) {
    let count = 0;
    const id = this.id(address);
    for (const follower of this.followersByUser.get(id) ?? []) {
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

    return {
      users: this.followDistanceByUser.size,
      follows,
      mutes,
      sizeByDistance,
    };
  }

  followedByFriends(address: string) {
    const id = this.id(address);
    const set = new Set<string>();
    for (const follower of this.followersByUser.get(id) ?? []) {
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
    for (const id of this.followersByUser.get(userId) || []) {
      set.add(this.str(id));
    }
    return set;
  }

  serialize(maxBytes?: number): SerializedSocialGraph {
    // added a bunch of stuff for maxBytes calculation
    const followLists: SerializedUserList[] = [];
    const muteLists: SerializedUserList[] = [];
    const usedIds = new Set<number>();

    // Calculate UTF-8 byte length of a positive integer
    const digitLength = (n: number) => n === 0 ? 1 : Math.floor(Math.log10(n)) + 1;

    // Bytes for one ["hex64",id] including the comma that will follow unless it is last
    const uidEntry = (id: number, first: boolean) => (first ? 1 : 2) + 64 + 2 + digitLength(id);

    // Fixed outer JSON structure size
    let currentSize = 2 + // { }
      '"followLists":'.length + 2 + 1 + // [] and following comma
      '"uniqueIds":'.length + 2 + 1 + // [] and following comma
      '"muteLists":'.length + 2; // [] and closing }

    let uidBytes = 0; // running size of uniqueIds array
    let uidFirst = true; // is next uid the first element?

    const accountUid = (id: number) => {
      if (usedIds.has(id)) return;
      usedIds.add(id);
      uidBytes += uidEntry(id, uidFirst);
      uidFirst = false;
      currentSize += uidEntry(id, uidFirst); // uid array lives inside the object
    };

    const addListChunk = (user: number, ids: number[], createdAt: number, isFollowList: boolean) => {
      /* ensure the owner's id is in uniqueIds BEFORE any size checks */
      accountUid(user);

      let firstInArray = isFollowList ? followLists.length === 0 : muteLists.length === 0;
      let chunkSize = (firstInArray ? 1 : 2) + // '[' or ',['
        digitLength(user) + 1 + // user and comma
        1 + // '[' for nested id array
        1 + // ']' empty array (will grow)
        1 + // comma
        digitLength(createdAt) + 1; // timestamp and closing ]

      const chunk: number[] = [];
      
      for (const id of ids) {
        const extra = (chunk.length ? 1 : 0) + digitLength(id); // preceding comma only after first id
        const extraWithUid = extra + (usedIds.has(id) ? 0 : uidEntry(id, uidFirst));
        if (maxBytes && currentSize + chunkSize + extraWithUid > maxBytes) {
          break;
        }
        chunk.push(id);
        chunkSize += extra;
        accountUid(id);
      }

      if (chunk.length === 0) {
        return;
      }

      currentSize += chunkSize;
      if (isFollowList) {
        followLists.push([user, chunk, createdAt]);
      } else {
        muteLists.push([user, chunk, createdAt]);
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

    for (const user of allUsers) {
      // Process follow list if available
      const followedUsers = this.followedByUser.get(user);
      const followListCreatedAt = this.followListCreatedAt.get(user);
      if (followedUsers && followListCreatedAt) {
        addListChunk(user, [...followedUsers.values()], followListCreatedAt, true);
      }

      // Process mute list if available
      const mutedUsers = this.mutedByUser.get(user);
      const muteListCreatedAt = this.muteListCreatedAt.get(user);
      if (mutedUsers && muteListCreatedAt) {
        addListChunk(user, [...mutedUsers.values()], muteListCreatedAt, false);
      }

      if (maxBytes && currentSize >= maxBytes) {
        break;
      }
    }

    return { 
      followLists, 
      uniqueIds: this.ids.serialize(usedIds), 
      muteLists 
    };
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
      const batchSize = 1000;
      let processedCount = 0;

      const processBatch = () => {
        let batchCount = 0;

        while (processedCount < users.length && batchCount < batchSize) {
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
          
          batchCount++;
          processedCount++;
        }

        // If we still have work to do, schedule the next batch
        if (processedCount < users.length) {
          queueMicrotask(processBatch);
        } else {
          // All users processed, now recalculate distances
          this.recalculateFollowDistances().then(() => {
            console.timeEnd('merge graph');
            console.log('size after merge', this.size());
            resolve();
          });
        }
      };

      // Start processing
      queueMicrotask(processBatch);
    });
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
    for (const follower of this.followersByUser.get(userId) || []) {
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

  removeMutedNotFollowedUsers() {
    const usersToRemove = new Set<number>();

    for (const [user, muters] of this.userMutedBy.entries()) {
      const followers = this.followersByUser.get(user) || new Set<number>();
      if (followers.size === 0 && muters.size > 0) {
        usersToRemove.add(user);
      }
    }

    for (const user of usersToRemove) {
      this.removeUserById(user);
    }

    return usersToRemove.size;
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

  toBinaryChunks(): AsyncGenerator<Uint8Array> {
    return Binary.toBinaryChunks(this);
  }

  toBinary(): Promise<Uint8Array> {
    return Binary.toBinary(this);
  }

  static fromBinary(root: string, data: Uint8Array): Promise<SocialGraph> {
    return Binary.fromBinary(root, data);
  }

  static fromBinaryStream(root: string, stream: ReadableStream<Uint8Array>): Promise<SocialGraph> {
    return Binary.fromBinaryStream(root, stream);
  }
}
