import { SocialGraph } from './SocialGraph';

export async function* toBinaryChunks(graph: SocialGraph): AsyncGenerator<Uint8Array> {
    const encoder = new TextEncoder();
    const { ids, followedByUser, followListCreatedAt, mutedByUser, muteListCreatedAt } = graph.getBinarySerializationData();
    
    // Header: uniqueIds length
    const entries = Array.from(ids);
    yield new Uint8Array(new Uint32Array([entries.length]).buffer);
    
    // UniqueIds entries
    for (const [id, str] of entries) {
        const strBytes = encoder.encode(str);
        yield new Uint8Array(new Uint16Array([strBytes.length]).buffer);
        yield strBytes;
        yield new Uint8Array(new Uint32Array([id]).buffer);
    }

    // Follow lists
    const followLists = Array.from(followedByUser.entries())
        .filter(([user]) => followListCreatedAt.has(user));
    yield new Uint8Array(new Uint32Array([followLists.length]).buffer);

    for (const [user, followed] of followLists) {
        const createdAt = followListCreatedAt.get(user) || 0;
        yield new Uint8Array(new Uint32Array([user, createdAt, followed.size]).buffer);
        yield new Uint8Array(new Uint32Array(Array.from(followed)).buffer);
    }

    // Mute lists
    const muteLists = Array.from(mutedByUser.entries())
        .filter(([user]) => muteListCreatedAt.has(user));
    yield new Uint8Array(new Uint32Array([muteLists.length]).buffer);

    for (const [user, muted] of muteLists) {
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
    const graph = new SocialGraph(root);
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

    // Build up the data to set
    const data = {
        strToUniqueId: new Map<string, number>(),
        uniqueIdToStr: new Map<number, string>(),
        currentUniqueId: 0,
        followListCreatedAt: new Map<number, number>(),
        mutedByUser: new Map<number, Set<number>>(),
        muteListCreatedAt: new Map<number, number>()
    };

    // Read uniqueIds
    const uniqueIdsLength = await readUint32();

    for (let i = 0; i < uniqueIdsLength; i++) {
        const strLen = await readUint16();
        const strBytes = await readBytes(strLen);
        const str = decoder.decode(strBytes);
        const id = await readUint32();
        data.strToUniqueId.set(str, id);
        data.uniqueIdToStr.set(id, str);
        data.currentUniqueId = Math.max(data.currentUniqueId, id + 1);
    }

    // Read follow lists
    const followListsLength = await readUint32();

    for (let i = 0; i < followListsLength; i++) {
        const userBytes = await readBytes(12); // user + createdAt + followedCount
        const [user, createdAt, followedCount] = new Uint32Array(userBytes.buffer);
        
        const followedBytes = await readBytes(followedCount * 4);
        const followedUsers = new Uint32Array(followedBytes.buffer);

        data.followListCreatedAt.set(user, createdAt);
        for (const followedUser of followedUsers) {
            graph.privateAddFollower(followedUser, user);
        }
    }

    // Read mute lists
    const muteListsLength = await readUint32();

    for (let i = 0; i < muteListsLength; i++) {
        const userBytes = await readBytes(12); // user + createdAt + mutedCount
        const [user, createdAt, mutedCount] = new Uint32Array(userBytes.buffer);
        
        const mutedBytes = await readBytes(mutedCount * 4);
        const mutedUsers = new Uint32Array(mutedBytes.buffer);

        data.muteListCreatedAt.set(user, createdAt);
        graph.mutedByUser.set(user, new Set(mutedUsers));
        for (const mutedUser of mutedUsers) {
            if (!graph.userMutedBy.has(mutedUser)) {
                graph.userMutedBy.set(mutedUser, new Set());
            }
            graph.userMutedBy.get(mutedUser)?.add(user);
        }
    }

    // Finally, set all the data at once
    graph.setBinarySerializationData(data);
    graph.recalculateFollowDistances();
    return graph;
} 