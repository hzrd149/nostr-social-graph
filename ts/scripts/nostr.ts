import { EventStore } from "applesauce-core";
import type { NostrEvent } from "applesauce-core/helpers";
import {
  createEventLoaderForStore,
  type LoadableAddressPointer,
  type UnifiedEventLoader,
} from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { lastValueFrom, mergeMap } from "rxjs";
import WebSocket from "ws";

import { RELAY_URLS } from "../src/constants";

Object.assign(globalThis, { WebSocket });

export type ScriptNostrContext = {
  store: EventStore;
  pool: RelayPool;
  loader: UnifiedEventLoader;
  relays: string[];
};

export function createScriptNostrContext(
  relayUrls = RELAY_URLS,
): ScriptNostrContext {
  const eventStore = new EventStore();
  const relayPool = new RelayPool();

  const loader = createEventLoaderForStore(eventStore, relayPool, {
    extraRelays: relayUrls,
    lookupRelays: relayUrls,
  });

  return { store: eventStore, pool: relayPool, loader, relays: relayUrls };
}

export function loadAddressPointer(
  context: ScriptNostrContext,
  pointer: LoadableAddressPointer,
): Promise<NostrEvent | undefined> {
  return lastValueFrom(context.loader(pointer), { defaultValue: undefined });
}

export async function loadAddressPointers(
  context: ScriptNostrContext,
  pointers: LoadableAddressPointer[],
  onEvent: (event: NostrEvent) => void | Promise<void>,
): Promise<void> {
  // Fetch all events in parallel
  await Promise.all(
    pointers.map((pointer) =>
      lastValueFrom(
        context.loader(pointer).pipe(
          mergeMap(async (event) => {
            // Run logic on each event
            await onEvent(event);
          }),
        ),
        { defaultValue: undefined },
      ),
    ),
  );
}

export type { LoadableAddressPointer };
