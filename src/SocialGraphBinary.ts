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

// Variable-length integer decoding
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

// All integers use varint encoding for consistency and simplicity

export async function* toBinaryChunks(graph: SocialGraph): AsyncGenerator<Uint8Array> {
    console.time("toBinaryChunks.total");

    // --- Phase 1: grab internal graph data ---
    console.time("phase.getInternalData");
    const data = getInternalData(graph);
    console.timeEnd("phase.getInternalData");

    // --- Helper utilities for fast byte writes ---
    const CHUNK_SIZE = 16 * 1024; // 16 KB – good compromise between memory & throughput
    const chunks: Uint8Array[] = [];
    let current = new Uint8Array(CHUNK_SIZE);
    let pos = 0;

    const flush = () => {
        if (pos === 0) return;
        // Only keep the written slice to avoid copying large unused portions
        chunks.push(current.subarray(0, pos));
        current = new Uint8Array(CHUNK_SIZE);
        pos = 0;
    };

    const writeByte = (b: number) => {
        if (pos >= current.length) flush();
        current[pos++] = b;
    };

    const writeBytes = (bytes: Uint8Array) => {
        let offset = 0;
        while (offset < bytes.length) {
            const available = current.length - pos;
            if (available === 0) {
                flush();
                continue;
            }
            const toCopy = Math.min(available, bytes.length - offset);
            current.set(bytes.subarray(offset, offset + toCopy), pos);
            pos += toCopy;
            offset += toCopy;
        }
    };

    const writeVarint = (value: number) => {
        let v = value >>> 0; // ensure unsigned 32-bit
        while (v >= 0x80) {
            writeByte((v & 0x7f) | 0x80);
            v >>>= 7;
        }
        writeByte(v & 0x7f);
    };

    // --- Phase 2: write version ---
    console.time("phase.writeVersion");
    writeVarint(BINARY_FORMAT_VERSION);
    console.timeEnd("phase.writeVersion");

    // --- Phase 3: collect IDs ---
    console.time("phase.collectIds");
    const usedIds = new Set<number>();

    for (const [user, followedUsers] of data.followedByUser.entries()) {
        usedIds.add(user);
        for (const followed of followedUsers) usedIds.add(followed);
    }
    for (const [user, mutedUsers] of data.mutedByUser.entries()) {
        usedIds.add(user);
        for (const muted of mutedUsers) usedIds.add(muted);
    }
    console.timeEnd("phase.collectIds");

    // --- Phase 4: write IDs block ---
    console.time("phase.writeIdsBlock");
    writeVarint(usedIds.size);
    for (const id of usedIds) {
        const hexBytes = hexToBytes(data.ids.str(id));
        writeBytes(hexBytes);
        writeVarint(id);
    }
    console.timeEnd("phase.writeIdsBlock");

    // --- Phase 5: serialize follow lists ---
    console.time("phase.serializeFollows");
    writeVarint(data.followedByUser.size);
    for (const [user, followedUsers] of data.followedByUser.entries()) {
        writeVarint(user);
        const timestamp = data.followListCreatedAt.get(user) || 0;
        writeVarint(timestamp);
        writeVarint(followedUsers.size);
        for (const followed of followedUsers) writeVarint(followed);
    }
    console.timeEnd("phase.serializeFollows");

    // --- Phase 6: serialize mute lists ---
    console.time("phase.serializeMutes");
    writeVarint(data.mutedByUser.size);
    for (const [user, mutedUsers] of data.mutedByUser.entries()) {
        writeVarint(user);
        const timestamp = data.muteListCreatedAt.get(user) || 0;
        writeVarint(timestamp);
        writeVarint(mutedUsers.size);
        for (const muted of mutedUsers) writeVarint(muted);
    }
    console.timeEnd("phase.serializeMutes");

    // push any remaining bytes
    flush();

    // --- Phase 7: emit chunks ---
    for (const c of chunks) {
        yield c;
    }
    console.timeEnd("toBinaryChunks.total");
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
    let offset = 0;
    
    // Read version
    const version = decodeVarint(data, offset);
    offset += version.bytesRead;
    
    // Read unique IDs
    const idsCount = decodeVarint(data, offset);
    offset += idsCount.bytesRead;
    
    const uniqueIds: [string, number][] = [];
    
    for (let i = 0; i < idsCount.value; i++) {
        // Read hex bytes (32 bytes for public key)
        const hexBytes = data.slice(offset, offset + 32);
        offset += 32;
        
        const hexStr = bytesToHex(hexBytes);
        
        const id = decodeVarint(data, offset);
        offset += id.bytesRead;
        
        uniqueIds.push([hexStr, id.value]);
    }
    
    // Read follow lists
    const followListsCount = decodeVarint(data, offset);
    offset += followListsCount.bytesRead;
    
    const followLists: [number, number[], number][] = [];
    
    for (let i = 0; i < followListsCount.value; i++) {
        const user = decodeVarint(data, offset);
        offset += user.bytesRead;
        
        const timestamp = decodeVarint(data, offset);
        offset += timestamp.bytesRead;
        
        const followedCount = decodeVarint(data, offset);
        offset += followedCount.bytesRead;
        
        const followedUsers: number[] = [];
        
        for (let j = 0; j < followedCount.value; j++) {
            const followedUser = decodeVarint(data, offset);
            offset += followedUser.bytesRead;
            followedUsers.push(followedUser.value);
        }
        
        followLists.push([user.value, followedUsers, timestamp.value]);
    }
    
    // Read mute lists
    const muteListsCount = decodeVarint(data, offset);
    offset += muteListsCount.bytesRead;
    
    const muteLists: [number, number[], number][] = [];
    
    for (let i = 0; i < muteListsCount.value; i++) {
        const user = decodeVarint(data, offset);
        offset += user.bytesRead;
        
        const timestamp = decodeVarint(data, offset);
        offset += timestamp.bytesRead;
        
        const mutedCount = decodeVarint(data, offset);
        offset += mutedCount.bytesRead;
        
        const mutedUsers: number[] = [];
        
        for (let j = 0; j < mutedCount.value; j++) {
            const mutedUser = decodeVarint(data, offset);
            offset += mutedUser.bytesRead;
            mutedUsers.push(mutedUser.value);
        }
        
        muteLists.push([user.value, mutedUsers, timestamp.value]);
    }
    
    // Create the SocialGraph with the deserialized data
    const serializedGraph = {
        uniqueIds,
        followLists,
        muteLists
    };
    
    return new SocialGraph(root, serializedGraph);
}

export async function fromBinaryStream(root: string, stream: ReadableStream<Uint8Array>): Promise<SocialGraph> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;
    
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            chunks.push(value);
            totalLength += value.length;
        }
    } finally {
        reader.releaseLock();
    }
    
    // Combine all chunks into a single buffer
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }
    
    return await fromBinary(root, combined);
} 