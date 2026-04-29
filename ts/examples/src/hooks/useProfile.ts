import { use$ } from "applesauce-react/hooks";
import fuseData from "../../../data/profileData.json";
import { eventStore } from "../utils/nostr";
import { ProfileContent } from "applesauce-core/helpers";

const profileCache = new Map<string, ProfileContent>();
fuseData.forEach((v) => {
  if (v[0] && v[1]) {
    let pictureUrl = v[3];
    if (pictureUrl && !pictureUrl.startsWith("http://")) {
      pictureUrl = `https://${pictureUrl}`;
    }
    profileCache.set(v[0], { name: v[1], picture: pictureUrl || undefined });
  }
});

export default function useProfile(pubKey?: string) {
  const cachedProfile = profileCache.get(pubKey || "");
  const profile = use$(
    () => (pubKey ? eventStore.profile(pubKey) : undefined),
    [pubKey],
  );

  return profile || cachedProfile || {};
}
