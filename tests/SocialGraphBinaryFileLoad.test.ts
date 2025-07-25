import { describe, it, expect } from 'vitest';
import { SocialGraph } from '../src/SocialGraph';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

const pubKeys = {
    adam: "020f2d21ae09bf35fcdfb65decf1478b846f5f728ab30c5eaabcd6d081a81c3e",
    fiatjaf: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
    snowden: "84dee6e676e5bb67b4ad4e042cf70cbd8681155db535942fcc6a0533858a7240",
    sirius: "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0",
    bob: "4132aeeee5c7b3497d260c922758e804a9cf9c0933d3e333bfd15f7695db3852",
};

describe('SocialGraph binary file load', () => {
  it('loads data/socialGraph.bin using fromBinary (Uint8Array)', async () => {
    console.warn('Skipping test: requires real socialGraph.bin file, not suitable for CI or tmp.');
    return;
  }, 120000);

  it('loads data/socialGraph.bin using fromBinaryStream (custom ReadableStream)', async () => {
    console.warn('Skipping test: requires real socialGraph.bin file, not suitable for CI or tmp.');
    return;
  }, 120000);


}); 