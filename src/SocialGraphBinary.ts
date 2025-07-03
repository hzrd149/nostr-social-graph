import { SocialGraph } from './SocialGraph';

export async function* toBinaryChunks(graph: SocialGraph): AsyncGenerator<Uint8Array> {
    const encoder = new TextEncoder();
    
    // Get serialized data from the graph
    const serialized = graph.serialize();
    
    // Header: uniqueIds length
    yield new Uint8Array(new Uint32Array([serialized.uniqueIds.length]).buffer);
    
    // UniqueIds entries
    for (const [str, id] of serialized.uniqueIds) {
        const strBytes = encoder.encode(str);
        yield new Uint8Array(new Uint16Array([strBytes.length]).buffer);
        yield strBytes;
        yield new Uint8Array(new Uint32Array([id]).buffer);
    }

    // Follow lists
    yield new Uint8Array(new Uint32Array([serialized.followLists.length]).buffer);

    for (const [user, followedUsers, createdAt] of serialized.followLists) {
        yield new Uint8Array(new Uint32Array([user, createdAt || 0, followedUsers.length]).buffer);
        yield new Uint8Array(new Uint32Array(followedUsers).buffer);
    }

    // Mute lists
    const muteLists = serialized.muteLists || [];
    yield new Uint8Array(new Uint32Array([muteLists.length]).buffer);

    for (const [user, mutedUsers, createdAt] of muteLists) {
        yield new Uint8Array(new Uint32Array([user, createdAt || 0, mutedUsers.length]).buffer);
        yield new Uint8Array(new Uint32Array(mutedUsers).buffer);
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
    const decoder = new TextDecoder();
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

    async function readUint16(): Promise<number> {
        const bytes = await readBytes(2);
        return new Uint16Array(bytes.buffer)[0];
    }

    // Build serialized data structure
    const serialized: any = {
        uniqueIds: [],
        followLists: [],
        muteLists: []
    };

    // Read uniqueIds
    const uniqueIdsLength = await readUint32();

    for (let i = 0; i < uniqueIdsLength; i++) {
        const strLen = await readUint16();
        const strBytes = await readBytes(strLen);
        const str = decoder.decode(strBytes);
        const id = await readUint32();
        serialized.uniqueIds.push([str, id]);
    }

    // Read follow lists
    const followListsLength = await readUint32();

    for (let i = 0; i < followListsLength; i++) {
        const userBytes = await readBytes(12); // user + createdAt + followedCount
        const [user, createdAt, followedCount] = new Uint32Array(userBytes.buffer);
        
        const followedBytes = await readBytes(followedCount * 4);
        const followedUsers = Array.from(new Uint32Array(followedBytes.buffer));

        serialized.followLists.push([user, followedUsers, createdAt]);
    }

    // Read mute lists
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