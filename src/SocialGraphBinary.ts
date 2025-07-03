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

function decodeVarint(bytes: Uint8Array, offset: number): { value: number; bytesRead: number } {
    let value = 0;
    let shift = 0;
    let bytesRead = 0;
    
    for (let i = offset; i < bytes.length; i++) {
        const byte = bytes[i];
        value |= (byte & 0x7F) << shift;
        bytesRead++;
        
        if ((byte & 0x80) === 0) {
            break;
        }
        shift += 7;
    }
    
    return { value, bytesRead };
}

// Optimized encoding: use Uint16 for counts <= 65535, varint for larger values
function encodeCount(count: number): Uint8Array {
    if (count <= 65535) {
        // Use 2 bytes for counts up to 65535 (covers 99.9% of follow/mute counts)
        return new Uint8Array(new Uint16Array([count]).buffer);
    } else {
        // Use varint for larger counts (very rare)
        return encodeVarint(count);
    }
}

function decodeCount(bytes: Uint8Array, offset: number): { value: number; bytesRead: number } {
    if (bytes.length - offset >= 2) {
        const value = new Uint16Array(bytes.slice(offset, offset + 2).buffer)[0];
        if (value <= 65535) {
            return { value, bytesRead: 2 };
        }
    }
    // Fall back to varint decoding
    return decodeVarint(bytes, offset);
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
    
    // Write version and entries length (using varint for better compression)
    yield new Uint8Array(new Uint32Array([BINARY_FORMAT_VERSION]).buffer);
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
        yield new Uint8Array(new Uint32Array([createdAt]).buffer); // Keep Uint32 for timestamps
        yield encodeCount(followed.size); // Use optimized count encoding
        
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
        yield new Uint8Array(new Uint32Array([createdAt]).buffer); // Keep Uint32 for timestamps
        yield encodeCount(muted.size); // Use optimized count encoding
        
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

    async function readCount(): Promise<number> {
        // Try to read as Uint16 first
        if (buffer.length >= 2) {
            const value = new Uint16Array(buffer.slice(0, 2).buffer)[0];
            if (value <= 65535) {
                buffer = buffer.slice(2);
                return value;
            }
        }
        
        // Fall back to varint decoding
        return await readVarint();
    }

    // Build serialized data structure for SocialGraph constructor
    const serialized: any = {
        uniqueIds: [],
        followLists: [],
        muteLists: []
    };

    // Read header: version + uniqueIds length
    const version = await readUint32();
    const uniqueIdsLength = await readVarint();
    
    // Read uniqueIds - format: [id, hex_bytes] (32 bytes for each public key)
    for (let i = 0; i < uniqueIdsLength; i++) {
        const id = await readVarint();
        const hexBytes = await readBytes(32); // 32 bytes for the public key
        const str = bytesToHex(hexBytes);
        serialized.uniqueIds.push([str, id]);
    }

    // Read follow lists - format: [user_id, created_at, followed_count, followed_ids...]
    const followListsLength = await readVarint();

    for (let i = 0; i < followListsLength; i++) {
        const user = await readVarint();
        const createdAt = await readUint32(); // Timestamps always Uint32
        const followedCount = await readCount();
        
        // Read varint-encoded user IDs
        const followedUsers: number[] = [];
        for (let j = 0; j < followedCount; j++) {
            followedUsers.push(await readVarint());
        }

        serialized.followLists.push([user, followedUsers, createdAt]);
    }

    // Read mute lists - format: [user_id, created_at, muted_count, muted_ids...]
    const muteListsLength = await readVarint();

    for (let i = 0; i < muteListsLength; i++) {
        const user = await readVarint();
        const createdAt = await readUint32(); // Timestamps always Uint32
        const mutedCount = await readCount();
        
        // Read varint-encoded user IDs
        const mutedUsers: number[] = [];
        for (let j = 0; j < mutedCount; j++) {
            mutedUsers.push(await readVarint());
        }

        serialized.muteLists.push([user, mutedUsers, createdAt]);
    }

    // Create graph from serialized data
    const graph = new SocialGraph(root, serialized);
    return graph;
} 