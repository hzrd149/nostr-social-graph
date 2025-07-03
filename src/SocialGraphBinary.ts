import { SocialGraph } from './SocialGraph';

// Binary format version - increment this when the format changes
// Note: The deserializer supports all version numbers by treating them as version 1 format,
// providing maximum compatibility for any serialized data regardless of version number.
export const BINARY_FORMAT_VERSION = 1;

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
    
    // Write version and entries length
    yield new Uint8Array(new Uint32Array([BINARY_FORMAT_VERSION, entries.length]).buffer);
    
    // UniqueIds entries - store as [id, hex_bytes] (32 bytes for each public key)
    for (const [id, str] of entries as [number, string][]) {
        const hexBytes = hexToBytes(str);
        yield new Uint8Array(new Uint32Array([id]).buffer);
        yield hexBytes; // 32 bytes for the public key
    }

    // Follow lists - store as [user_id, created_at, followed_count, followed_ids...]
    const followLists = Array.from(followedByUser.entries())
        .filter((entry) => followListCreatedAt.has((entry as [number, Set<number>])[0]));
    yield new Uint8Array(new Uint32Array([followLists.length]).buffer);

    for (const [user, followed] of followLists as [number, Set<number>][]) {
        const createdAt = followListCreatedAt.get(user) || 0;
        yield new Uint8Array(new Uint32Array([user, createdAt, followed.size]).buffer);
        yield new Uint8Array(new Uint32Array(Array.from(followed)).buffer);
    }

    // Mute lists - store as [user_id, created_at, muted_count, muted_ids...]
    const muteLists = Array.from(mutedByUser.entries())
        .filter((entry) => muteListCreatedAt.has((entry as [number, Set<number>])[0]));
    yield new Uint8Array(new Uint32Array([muteLists.length]).buffer);

    for (const [user, muted] of muteLists as [number, Set<number>][]) {
        const createdAt = muteListCreatedAt.get(user) || 0;
        yield new Uint8Array(new Uint32Array([user, createdAt, muted.size]).buffer);
        yield new Uint8Array(new Uint32Array(Array.from(muted)).buffer);
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

export function fromBinary(root: string, data: Uint8Array): Promise<SocialGraph> {
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(data);
            controller.close();
        }
    });
    
    return fromBinaryStream(root, stream);
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

    async function readUint32(): Promise<number> {
        const bytes = await readBytes(4);
        return new Uint32Array(bytes.buffer)[0];
    }

    // Build serialized data structure for SocialGraph constructor
    const serialized: any = {
        uniqueIds: [],
        followLists: [],
        muteLists: []
    };

    // Read header: version + uniqueIds length
    const headerBytes = await readBytes(8); // version + uniqueIdsLength
    const [, uniqueIdsLength] = new Uint32Array(headerBytes.buffer);
    
    // Handle all versions using the current format (version 1)
    // This provides maximum compatibility for any version number
    // Read uniqueIds - format: [id, hex_bytes] (32 bytes for each public key)
    for (let i = 0; i < uniqueIdsLength; i++) {
        const id = await readUint32();
        const hexBytes = await readBytes(32); // 32 bytes for the public key
        const str = bytesToHex(hexBytes);
        serialized.uniqueIds.push([str, id]);
    }

    // Read follow lists - format: [user_id, created_at, followed_count, followed_ids...]
    const followListsLength = await readUint32();

    for (let i = 0; i < followListsLength; i++) {
        const userBytes = await readBytes(12); // user + createdAt + followedCount
        const [user, createdAt, followedCount] = new Uint32Array(userBytes.buffer);
        
        const followedBytes = await readBytes(followedCount * 4);
        const followedUsers = Array.from(new Uint32Array(followedBytes.buffer));

        serialized.followLists.push([user, followedUsers, createdAt]);
    }

    // Read mute lists - format: [user_id, created_at, muted_count, muted_ids...]
    const muteListsLength = await readUint32();

    for (let i = 0; i < muteListsLength; i++) {
        const userBytes = await readBytes(12); // user + createdAt + mutedCount
        const [user, createdAt, mutedCount] = new Uint32Array(userBytes.buffer);
        
        const mutedBytes = await readBytes(mutedCount * 4);
        const mutedUsers = Array.from(new Uint32Array(mutedBytes.buffer));

        serialized.muteLists.push([user, mutedUsers, createdAt]);
    }

    // Create graph from serialized data
    const graph = new SocialGraph(root, serialized);
    return graph;
} 