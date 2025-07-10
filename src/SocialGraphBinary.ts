import { SocialGraph } from './SocialGraph';

// Binary format version - increment this when the format changes
// Note: The deserializer supports all version numbers by treating them as version 1 format,
// providing maximum compatibility for any serialized data regardless of version number.
export const BINARY_FORMAT_VERSION = 2;

// Helper function to get internal data from SocialGraph
function getInternalData(graph: SocialGraph) {
    // Access private properties through any type
    const anyGraph = graph as any;
    return {
        ids: anyGraph.ids,
        followedByUser: anyGraph.followedByUser,
        followListCreatedAt: anyGraph.followListCreatedAt,
        mutedByUser: anyGraph.mutedByUser,
        muteListCreatedAt: anyGraph.muteListCreatedAt,
    };
}

// Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
        throw new Error(`Invalid hex string: ${hex}`);
    }
    if (hex.length % 2 !== 0) {
        throw new Error(`Hex string must have even length: ${hex}`);
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

// Convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Variable-length integer encoding (similar to Protocol Buffers varint)
function encodeVarint(value: number): Uint8Array {
    const bytes: number[] = [];
    let v = value;
    
    while (v >= 0x80) {
        bytes.push((v & 0x7F) | 0x80);
        v >>>= 7;
    }
    bytes.push(v & 0x7F);
    
    return new Uint8Array(bytes);
}



// All integers use varint encoding for consistency and simplicity

export async function* toBinaryChunks(graph: SocialGraph): AsyncGenerator<Uint8Array> {
    const { ids, followedByUser, followListCreatedAt, mutedByUser, muteListCreatedAt } = getInternalData(graph);
    
    // Header: version + uniqueIds length
    const entries = Array.from(ids).filter((entry) => {
        const [, str] = entry as [number, string];
        // Skip empty strings and invalid public keys
        if (!str || str.trim() === '' || !/^[0-9a-fA-F]{64}$/.test(str)) {
            console.warn(`Skipping invalid public key: "${str}"`);
            return false;
        }
        return true;
    });
    
    // Write version and entries length (using varint for consistency)
    yield encodeVarint(BINARY_FORMAT_VERSION);
    yield encodeVarint(entries.length);
    
    // UniqueIds entries - store as [id, hex_bytes] (32 bytes for each public key)
    for (const [id, str] of entries as [number, string][]) {
        const hexBytes = hexToBytes(str);
        yield encodeVarint(id); // Use varint for user IDs
        yield hexBytes; // 32 bytes for the public key
    }

    // Follow lists - store as [user_id, created_at, followed_count, followed_ids...]
    const followLists = Array.from(followedByUser.entries())
        .filter((entry) => followListCreatedAt.has((entry as [number, Set<number>])[0]));
    yield encodeVarint(followLists.length);

    for (const [user, followed] of followLists as [number, Set<number>][]) {
        const createdAt = followListCreatedAt.get(user) || 0;
        yield encodeVarint(user); // Use varint for user IDs
        yield encodeVarint(createdAt); // Use varint for timestamps
        yield encodeVarint(followed.size); // Use varint for count
        
        // Use varint encoding for follow list user IDs (most are small numbers)
        for (const followedId of followed) {
            yield encodeVarint(followedId);
        }
    }

    // Mute lists - store as [user_id, created_at, muted_count, muted_ids...]
    const muteLists = Array.from(mutedByUser.entries())
        .filter((entry) => muteListCreatedAt.has((entry as [number, Set<number>])[0]));
    yield encodeVarint(muteLists.length);

    for (const [user, muted] of muteLists as [number, Set<number>][]) {
        const createdAt = muteListCreatedAt.get(user) || 0;
        yield encodeVarint(user); // Use varint for user IDs
        yield encodeVarint(createdAt); // Use varint for timestamps
        yield encodeVarint(muted.size); // Use varint for count
        
        // Use varint encoding for mute list user IDs (most are small numbers)
        for (const mutedId of muted) {
            yield encodeVarint(mutedId);
        }
    }
}

export async function toBinary(graph: SocialGraph): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let totalLength = 0;
    
    for await (const chunk of toBinaryChunks(graph)) {
        chunks.push(chunk);
        totalLength += chunk.length;
    }
    
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    
    return result;
}

export async function fromBinary(root: string, data: Uint8Array): Promise<SocialGraph> {
    return new Promise((resolve, reject) => {
        let offset = 0;

        function readBytes(count: number): Uint8Array {
            if (offset + count > data.length) {
                throw new Error('Unexpected end of data');
            }
            const result = data.slice(offset, offset + count);
            offset += count;
            return result;
        }

        function readVarint(): number {
            let value = 0;
            let shift = 0;
            
            while (true) {
                const bytes = readBytes(1);
                const byte = bytes[0];
                value |= (byte & 0x7F) << shift;
                
                if ((byte & 0x80) === 0) {
                    break;
                }
                shift += 7;
            }
            
            return value;
        }

        try {
            // Read header: version + uniqueIds length
            readVarint(); // Read version but don't use it (for future compatibility)
            const uniqueIdsLength = readVarint();
            
            // Read uniqueIds first to build the serialized structure
            const uniqueIds: [string, number][] = [];
            for (let i = 0; i < uniqueIdsLength; i++) {
                const id = readVarint();
                const hexBytes = readBytes(32); // 32 bytes for the public key
                const str = bytesToHex(hexBytes);
                uniqueIds.push([str, id]);
            }

            // Create SocialGraph with the uniqueIds
            const graph = new SocialGraph(root, { uniqueIds, followLists: [], muteLists: [] });

            // Read follow lists - format: [user_id, created_at, followed_count, followed_ids...]
            const followListsLength = readVarint();
            const followListData: Array<[number, number[], number]> = [];

            for (let i = 0; i < followListsLength; i++) {
                const user = readVarint();
                const createdAt = readVarint(); // Timestamps always varint
                const followedCount = readVarint();
                
                // Read varint-encoded user IDs
                const followedUsers: number[] = [];
                for (let j = 0; j < followedCount; j++) {
                    followedUsers.push(readVarint());
                }

                followListData.push([user, followedUsers, createdAt]);
            }

            // Read mute lists - format: [user_id, created_at, muted_count, muted_ids...]
            const muteListsLength = readVarint();
            const muteListData: Array<[number, number[], number]> = [];

            for (let i = 0; i < muteListsLength; i++) {
                const user = readVarint();
                const createdAt = readVarint();
                const mutedCount = readVarint();
                
                // Read varint-encoded user IDs
                const mutedUsers: number[] = [];
                for (let j = 0; j < mutedCount; j++) {
                    mutedUsers.push(readVarint());
                }

                muteListData.push([user, mutedUsers, createdAt]);
            }

            // Process follow lists in batches
            const processFollowLists = () => {
                const batchSize = 1000;
                let processedCount = 0;

                const processBatch = () => {
                    let batchCount = 0;

                    while (processedCount < followListData.length && batchCount < batchSize) {
                        const [follower, followedUsers, createdAt] = followListData[processedCount];
                        
                        // Set the creation timestamp first
                        const anyGraph = graph as any;
                        anyGraph.followListCreatedAt.set(follower, createdAt);
                        
                        // Add each follow relationship
                        for (const followedUser of followedUsers) {
                            anyGraph.privateAddFollower(followedUser, follower);
                        }
                        
                        batchCount++;
                        processedCount++;
                    }

                    // If we still have work to do, schedule the next batch
                    if (processedCount < followListData.length) {
                        queueMicrotask(processBatch);
                    } else {
                        // All follow lists processed, now process mute lists
                        processMuteLists();
                    }
                };

                // Start processing
                queueMicrotask(processBatch);
            };

            // Process mute lists in batches
            const processMuteLists = () => {
                const batchSize = 1000;
                let processedCount = 0;

                const processBatch = () => {
                    let batchCount = 0;

                    while (processedCount < muteListData.length && batchCount < batchSize) {
                        const [muter, mutedUsers, createdAt] = muteListData[processedCount];
                        
                        // Set the creation timestamp first
                        const anyGraph = graph as any;
                        anyGraph.muteListCreatedAt.set(muter, createdAt);
                        
                        // Set up the mute relationships
                        anyGraph.mutedByUser.set(muter, new Set(mutedUsers));
                        for (const mutedUser of mutedUsers) {
                            if (!anyGraph.userMutedBy.has(mutedUser)) {
                                anyGraph.userMutedBy.set(mutedUser, new Set());
                            }
                            anyGraph.userMutedBy.get(mutedUser)?.add(muter);
                        }
                        
                        batchCount++;
                        processedCount++;
                    }

                    // If we still have work to do, schedule the next batch
                    if (processedCount < muteListData.length) {
                        queueMicrotask(processBatch);
                    } else {
                        // All mute lists processed, now recalculate follow distances
                        graph.recalculateFollowDistances().then(() => {
                            resolve(graph);
                        }).catch(reject);
                    }
                };

                // Start processing
                queueMicrotask(processBatch);
            };

            // Start processing follow lists
            processFollowLists();

        } catch (error) {
            reject(error);
        }
    });
}

export async function fromBinaryStream(root: string, stream: ReadableStream<Uint8Array>): Promise<SocialGraph> {
    const reader = stream.getReader();
    let buffer = new Uint8Array(0);

    async function readBytes(count: number): Promise<Uint8Array> {
        while (buffer.length < count) {
            const { value, done } = await reader.read();
            if (done) throw new Error('Unexpected end of stream');
            const newBuffer = new Uint8Array(buffer.length + value.length);
            newBuffer.set(buffer);
            newBuffer.set(value, buffer.length);
            buffer = newBuffer;
        }
        const result = buffer.slice(0, count);
        buffer = buffer.slice(count);
        return result;
    }

    async function readVarint(): Promise<number> {
        let value = 0;
        let shift = 0;
        
        while (true) {
            const bytes = await readBytes(1);
            const byte = bytes[0];
            value |= (byte & 0x7F) << shift;
            
            if ((byte & 0x80) === 0) {
                break;
            }
            shift += 7;
        }
        
        return value;
    }

    // Read header: version + uniqueIds length
    await readVarint(); // Read version but don't use it (for future compatibility)
    const uniqueIdsLength = await readVarint();
    
    // Read uniqueIds first to build the serialized structure
    const uniqueIds: [string, number][] = [];
    for (let i = 0; i < uniqueIdsLength; i++) {
        const id = await readVarint();
        const hexBytes = await readBytes(32); // 32 bytes for the public key
        const str = bytesToHex(hexBytes);
        uniqueIds.push([str, id]);
    }

    // Create SocialGraph with the uniqueIds
    const graph = new SocialGraph(root, { uniqueIds, followLists: [], muteLists: [] });

    // Read follow lists - format: [user_id, created_at, followed_count, followed_ids...]
    const followListsLength = await readVarint();
    const followListData: Array<[number, number[], number]> = [];

    for (let i = 0; i < followListsLength; i++) {
        const user = await readVarint();
        const createdAt = await readVarint(); // Timestamps always varint
        const followedCount = await readVarint();
        
        // Read varint-encoded user IDs
        const followedUsers: number[] = [];
        for (let j = 0; j < followedCount; j++) {
            followedUsers.push(await readVarint());
        }

        followListData.push([user, followedUsers, createdAt]);
    }

    // Read mute lists - format: [user_id, created_at, muted_count, muted_ids...]
    const muteListsLength = await readVarint();
    const muteListData: Array<[number, number[], number]> = [];

    for (let i = 0; i < muteListsLength; i++) {
        const user = await readVarint();
        const createdAt = await readVarint();
        const mutedCount = await readVarint();
        
        // Read varint-encoded user IDs
        const mutedUsers: number[] = [];
        for (let j = 0; j < mutedCount; j++) {
            mutedUsers.push(await readVarint());
        }

        muteListData.push([user, mutedUsers, createdAt]);
    }

    // Process follow lists in batches
    const processFollowLists = (): Promise<void> => {
        return new Promise((resolve) => {
            const batchSize = 1000;
            let processedCount = 0;

            const processBatch = () => {
                let batchCount = 0;

                while (processedCount < followListData.length && batchCount < batchSize) {
                    const [follower, followedUsers, createdAt] = followListData[processedCount];
                    
                    // Set the creation timestamp first
                    const anyGraph = graph as any;
                    anyGraph.followListCreatedAt.set(follower, createdAt);
                    
                    // Add each follow relationship
                    for (const followedUser of followedUsers) {
                        anyGraph.privateAddFollower(followedUser, follower);
                    }
                    
                    batchCount++;
                    processedCount++;
                }

                // If we still have work to do, schedule the next batch
                if (processedCount < followListData.length) {
                    queueMicrotask(processBatch);
                } else {
                    // All follow lists processed, now process mute lists
                    resolve();
                }
            };

            // Start processing
            queueMicrotask(processBatch);
        });
    };

    // Process mute lists in batches
    const processMuteLists = (): Promise<void> => {
        return new Promise((resolve) => {
            const batchSize = 1000;
            let processedCount = 0;

            const processBatch = () => {
                let batchCount = 0;

                while (processedCount < muteListData.length && batchCount < batchSize) {
                    const [muter, mutedUsers, createdAt] = muteListData[processedCount];
                    
                    // Set the creation timestamp first
                    const anyGraph = graph as any;
                    anyGraph.muteListCreatedAt.set(muter, createdAt);
                    
                    // Set up the mute relationships
                    anyGraph.mutedByUser.set(muter, new Set(mutedUsers));
                    for (const mutedUser of mutedUsers) {
                        if (!anyGraph.userMutedBy.has(mutedUser)) {
                            anyGraph.userMutedBy.set(mutedUser, new Set());
                        }
                        anyGraph.userMutedBy.get(mutedUser)?.add(muter);
                    }
                    
                    batchCount++;
                    processedCount++;
                }

                // If we still have work to do, schedule the next batch
                if (processedCount < muteListData.length) {
                    queueMicrotask(processBatch);
                } else {
                    // All mute lists processed
                    resolve();
                }
            };

            // Start processing
            queueMicrotask(processBatch);
        });
    };

    // Process all data in sequence
    await processFollowLists();
    await processMuteLists();
    
    // Wait for follow distances to be calculated
    await graph.recalculateFollowDistances();
    
    return graph;
} 