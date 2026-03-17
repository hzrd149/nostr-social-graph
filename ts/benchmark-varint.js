// Benchmark varint vs fixed-width integer performance
import { performance } from 'perf_hooks';

// Varint encoding/decoding functions (copied from SocialGraphBinary.ts)
function encodeVarint(value) {
    const bytes = [];
    let v = value;
    
    while (v >= 0x80) {
        bytes.push((v & 0x7F) | 0x80);
        v >>>= 7;
    }
    bytes.push(v & 0x7F);
    
    return new Uint8Array(bytes);
}

function decodeVarint(bytes, offset = 0) {
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

// Test data - typical user IDs from social graph
const testIds = [];
for (let i = 0; i < 1000000; i++) {
    // Generate IDs similar to real data distribution
    if (i < 100000) {
        testIds.push(i); // Small IDs (most common)
    } else if (i < 500000) {
        testIds.push(100000 + Math.floor(Math.random() * 50000)); // Medium IDs
    } else {
        testIds.push(150000 + Math.floor(Math.random() * 100000)); // Large IDs
    }
}

console.log('=== VARINT vs FIXED-WIDTH BENCHMARK ===');
console.log('Test data size:', testIds.length, 'integers');
let minId = Infinity, maxId = -Infinity;
for (const id of testIds) {
    if (id < minId) minId = id;
    if (id > maxId) maxId = id;
}
console.log('ID range:', minId, 'to', maxId);

// Benchmark varint encoding
console.log('\n--- VARINT ENCODING ---');
const varintEncodeStart = performance.now();
const varintEncoded = [];
let varintTotalBytes = 0;
for (const id of testIds) {
    const encoded = encodeVarint(id);
    varintEncoded.push(encoded);
    varintTotalBytes += encoded.length;
}
const varintEncodeTime = performance.now() - varintEncodeStart;
console.log(`Encoding time: ${varintEncodeTime.toFixed(2)}ms`);
console.log(`Total bytes: ${varintTotalBytes}`);
console.log(`Average bytes per ID: ${(varintTotalBytes / testIds.length).toFixed(2)}`);

// Benchmark varint decoding
console.log('\n--- VARINT DECODING ---');
const varintDecodeStart = performance.now();
for (const encoded of varintEncoded) {
    decodeVarint(encoded);
}
const varintDecodeTime = performance.now() - varintDecodeStart;
console.log(`Decoding time: ${varintDecodeTime.toFixed(2)}ms`);

// Benchmark Uint16 encoding
console.log('\n--- UINT16 ENCODING ---');
const uint16EncodeStart = performance.now();
const uint16Encoded = [];
for (const id of testIds) {
    const encoded = new Uint8Array(new Uint16Array([id]).buffer);
    uint16Encoded.push(encoded);
}
const uint16EncodeTime = performance.now() - uint16EncodeStart;
console.log(`Encoding time: ${uint16EncodeTime.toFixed(2)}ms`);
console.log(`Total bytes: ${testIds.length * 2}`);
console.log(`Average bytes per ID: 2.00`);

// Benchmark Uint16 decoding
console.log('\n--- UINT16 DECODING ---');
const uint16DecodeStart = performance.now();
for (const encoded of uint16Encoded) {
    new Uint16Array(encoded.buffer)[0];
}
const uint16DecodeTime = performance.now() - uint16DecodeStart;
console.log(`Decoding time: ${uint16DecodeTime.toFixed(2)}ms`);

// Benchmark Uint32 encoding
console.log('\n--- UINT32 ENCODING ---');
const uint32EncodeStart = performance.now();
const uint32Encoded = [];
for (const id of testIds) {
    const encoded = new Uint8Array(new Uint32Array([id]).buffer);
    uint32Encoded.push(encoded);
}
const uint32EncodeTime = performance.now() - uint32EncodeStart;
console.log(`Encoding time: ${uint32EncodeTime.toFixed(2)}ms`);
console.log(`Total bytes: ${testIds.length * 4}`);
console.log(`Average bytes per ID: 4.00`);

// Benchmark Uint32 decoding
console.log('\n--- UINT32 DECODING ---');
const uint32DecodeStart = performance.now();
for (const encoded of uint32Encoded) {
    new Uint32Array(encoded.buffer)[0];
}
const uint32DecodeTime = performance.now() - uint32DecodeStart;
console.log(`Decoding time: ${uint32DecodeTime.toFixed(2)}ms`);

// Summary
console.log('\n=== PERFORMANCE SUMMARY ===');
console.log('Encoding speed (lower is better):');
console.log(`  Varint:   ${varintEncodeTime.toFixed(2)}ms`);
console.log(`  Uint16:   ${uint16EncodeTime.toFixed(2)}ms`);
console.log(`  Uint32:   ${uint32EncodeTime.toFixed(2)}ms`);
console.log(`  Varint vs Uint16: ${(varintEncodeTime / uint16EncodeTime).toFixed(2)}x slower`);
console.log(`  Varint vs Uint32: ${(varintEncodeTime / uint32EncodeTime).toFixed(2)}x slower`);

console.log('\nDecoding speed (lower is better):');
console.log(`  Varint:   ${varintDecodeTime.toFixed(2)}ms`);
console.log(`  Uint16:   ${uint16DecodeTime.toFixed(2)}ms`);
console.log(`  Uint32:   ${uint32DecodeTime.toFixed(2)}ms`);
console.log(`  Varint vs Uint16: ${(varintDecodeTime / uint16DecodeTime).toFixed(2)}x slower`);
console.log(`  Varint vs Uint32: ${(varintDecodeTime / uint32DecodeTime).toFixed(2)}x slower`);

console.log('\nCompression (lower is better):');
console.log(`  Varint:   ${(varintTotalBytes / (testIds.length * 4)).toFixed(2)}x smaller than Uint32`);
console.log(`  Uint16:   ${(2 / 4).toFixed(2)}x smaller than Uint32`);
console.log(`  Uint32:   1.00x (baseline)`); 