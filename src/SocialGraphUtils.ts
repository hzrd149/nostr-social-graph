import { SocialGraph } from './SocialGraph';
import { UID } from './UniqueIds';

/**
 * Utility methods for SocialGraph
 */
export class SocialGraphUtils {

  /**
   * Remove users who are muted by someone AND have zero followers.
   * O(E + M) where E = follows edges, M = mutes edges.
   * TODO: this is still blocking / not performant
   */
  static removeMutedNotFollowedUsers(
    graph: SocialGraph,
    batchSize = 50_000,
    logger: (scanned: number, removed: number) => void = () => {}
  ): number {
    const { followedByUser, userMutedBy } = graph.getInternalData();

    // 1) Build follower counts once if we don't have followersByUser cached.
    const followerCount = new Map<number, number>();
    for (const [, outs] of followedByUser) {
      for (const u of outs) {
        followerCount.set(u, (followerCount.get(u) ?? 0) + 1);
      }
    }

    // 2) Scan muted users; collect those with zero followers.
    const usersToRemove: number[] = [];
    let scanned = 0;

    for (const [user, muters] of userMutedBy) {
      scanned++;
      if (muters.size > 0 && (followerCount.get(user) ?? 0) === 0) {
        usersToRemove.push(user);
      }
      if (scanned % batchSize === 0) logger(scanned, usersToRemove.length);
    }

    // 3) Remove them.
    for (const id of usersToRemove) {
      SocialGraphUtils.removeUserById(graph, id);
    }

    logger(scanned, usersToRemove.length);
    return usersToRemove.length;
  }

  /**
   * Remove a user by ID from all internal data structures
   */
  static removeUserById(graph: SocialGraph, user: UID): void {
    const { ids } = graph.getInternalData();
    const graphAny = graph as any;

    // Remove from UniqueIds
    ids.remove(user);

    // Remove from all maps
    graphAny.followDistanceByUser.delete(user);
    graphAny.followedByUser.delete(user);
    graphAny.followersByUser.delete(user);
    graphAny.followListCreatedAt.delete(user);
    graphAny.mutedByUser.delete(user);
    graphAny.userMutedBy.delete(user);
    graphAny.muteListCreatedAt.delete(user);

    // Remove user from all sets
    graphAny.usersByFollowDistance.forEach((set: Set<number>) => set.delete(user));
    graphAny.followedByUser.forEach((set: Set<number>) => set.delete(user));
    graphAny.followersByUser.forEach((set: Set<number>) => set.delete(user));
    graphAny.mutedByUser.forEach((set: Set<number>) => set.delete(user));
    graphAny.userMutedBy.forEach((set: Set<number>) => set.delete(user));
  }

  /**
   * Get follower and muter counts by distance for a user
   */
  static stats(graph: SocialGraph, user: string): { [distance: number]: { followers: number; muters: number } } {
    const stats: { [distance: number]: { followers: number; muters: number } } = {};
    const graphAny = graph as any;
    const userId = graphAny.id(user);

    // Get followers set (using the private method)
    const followersSet = SocialGraphUtils.getFollowersSet(graph, userId);
    
    for (const follower of followersSet) {
      const distance = graphAny.followDistanceByUser.get(follower);
      if (distance !== undefined) {
        if (!stats[distance]) {
          stats[distance] = { followers: 0, muters: 0 };
        }
        stats[distance].followers++;
      }
    }

    for (const muter of graphAny.userMutedBy.get(userId) || []) {
      const distance = graphAny.followDistanceByUser.get(muter);
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
   * Get followers set for a user ID (helper method)
   */
  static getFollowersSet(graph: SocialGraph, id: number): Set<number> {
    const graphAny = graph as any;
    const { followedByUser } = graph.getInternalData();
    
    // Prefer the cached value when it exists (small graphs / earlier versions)
    const cached = graphAny.followersByUser.get(id);
    if (cached) {
      return cached;
    }
    
    // Compute followers by walking the outgoing follow lists.
    const computed = new Set<number>();
    for (const [follower, followed] of followedByUser) {
      if (followed.has(id)) {
        computed.add(follower);
      }
    }
    return computed;
  }
} 