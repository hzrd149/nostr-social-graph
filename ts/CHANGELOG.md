# Changelog

## 1.0.36

- Fix `SocialGraphBinary.fromBinary` to recalculate follow distances
  after deserializing instead of trusting the on-disk ordering, so a
  reloaded graph matches one built incrementally.
- `SocialGraph.handleEvent` and the private follow/mute handlers now
  return a boolean indicating whether the graph changed, letting
  callers skip work (e.g. `saveGraph()`) on no-op events.
- Add `SocialGraph.getMuteListCreatedAt(pubkey)`.

## 1.0.33

- Last release on the pre-pnpm workspace layout.
