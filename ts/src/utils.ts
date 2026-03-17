export function isValidPubKey(key: string): boolean {
    if (key.length !== 64) return false;
    for (let i = 0; i < 64; i++) {
        const c = key.charCodeAt(i);
        if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70))) {
            return false;
        }
    }
    return true;
}

export type NostrEvent = {
    created_at: number;
    content: string;
    tags: string[][];
    kind: number;
    pubkey: string;
    id: string;
    sig: string;
};