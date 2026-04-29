import socialGraph from "../utils/socialGraph";
import { useEffect, useState } from "react";
import { NostrEvent } from "../../../src";
import { use$ } from "applesauce-react/hooks";
import { eventStore } from "../utils/nostr";

const useFollows = (pubKey: string, includeSelf = false) => {
  const [follows, setFollows] = useState([
    ...socialGraph().getFollowedByUser(pubKey, includeSelf),
  ]);
  const contactsEvent = use$(
    () => (pubKey ? eventStore.replaceable(3, pubKey) : undefined),
    [pubKey],
  );

  useEffect(() => {
    if (contactsEvent) {
      socialGraph().handleEvent(contactsEvent as NostrEvent);
    }

    setFollows([...socialGraph().getFollowedByUser(pubKey, includeSelf)]);
  }, [pubKey, includeSelf, contactsEvent]);

  return follows;
};

export default useFollows;
