import { PROFILE_NAME_MAX_LENGTH } from "../src/constants";

export type CanonicalProfile = {
  primaryName?: string;
  names: string[];
  nip05?: string;
};

function normalizeNameValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, PROFILE_NAME_MAX_LENGTH);
}

export function extractProfileNames(profile: Record<string, unknown>): string[] {
  const candidates = [
    profile.display_name,
    profile.displayName,
    profile.name,
    profile.username,
  ];
  const names: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const normalized = normalizeNameValue(candidate);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    names.push(normalized);
  }

  return names;
}

function shouldRejectNip05(nip05: string, name: string): boolean {
  if (nip05.length === 1 || nip05.startsWith("npub1")) {
    return true;
  }
  if (!name) {
    return false;
  }
  return name.toLowerCase().replace(/\s+/g, "").includes(nip05);
}

export function normalizeNip05(value: unknown, primaryName?: string): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const localPart = value.split("@")[0]?.trim().toLowerCase().slice(0, PROFILE_NAME_MAX_LENGTH);
  if (!localPart) {
    return undefined;
  }
  if (primaryName && shouldRejectNip05(localPart, primaryName)) {
    return undefined;
  }
  return localPart;
}

export function canonicalizeProfile(profile: Record<string, unknown>): CanonicalProfile {
  const names = extractProfileNames(profile);
  const primaryName = names[0];
  const nip05 = normalizeNip05(profile.nip05, primaryName);

  return {
    primaryName,
    names,
    nip05,
  };
}
