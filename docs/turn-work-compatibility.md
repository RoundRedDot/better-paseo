# Completed work folding compatibility

This feature is a preview pending an upstream Paseo API change. Do not release it as supported
on Paseo 0.15.4. The current public transformer callback supplies only `item` and `phase`.
Safe grouping needs the host to also supply `agentId`, `sourceId` and `sourceCursor`.
The plugin checks these fields at runtime and leaves normal enhanced rows intact if any is
missing. Its existing minimum version remains valid for that fallback; no released version is
claimed to support folding yet.

## Why source identity is required

Paseo copies and freezes the source item when its projection cache misses. Registering a
transformer again changes the cache identity, so JavaScript object identity cannot identify a
source across projections. Content alone cannot identify its agent: thoughts and tool call IDs
can repeat in unrelated conversations or in different turns of the same conversation. The
cursor's epoch and exact sequence identify the canonical history record (`Entry.seqEnd`). A
sequence range is insufficient because a merged tool's range can overlap unrelated records.

An earlier prototype learned ownership from renderer mounts and attached it to the transform
input object. Reprojection lost that association and triggered another projection indefinitely.
It also emitted constant replacement IDs, which collided in Paseo's row and layout maps.

The replacement implementation receives ownership from the host, uses per-agent completed-turn
snapshots, and omits replacement IDs so Paseo derives them from its source IDs. Renderers retain
the shared timeline observation; they do not change projection ownership. Snapshots are cleared
on failed reads, history replacement and reconnect. If folding unmounts the last visible member
while its summary is offscreen, the admitted group keeps its existing event observation without
background refetches. The next lifecycle event or feature cleanup releases it. This lease shares
the projection registry's capacity bound. Missing or ambiguous data leaves the process visible.

Returning an empty replacement array removes a hidden member's host cell and its spacing.
Returning `null` from a renderer does not remove that cell. A retained summary therefore carries
its own counts and always renders while the next history read settles.

## Proposed upstream contract

Keep the synchronous callback and add `agentId: string`, `sourceId: string`, and
`sourceCursor: { epoch: string; seq: number } | null`. The host already has the source ID and
timeline cursor before calling plugins. It must pass them through and scope cached results by
agent as well as transformer/source. A null cursor leaves a source visible.
Existing plugins can ignore these fields. Better Paseo uses them without a dependency upgrade
until the API ships; the preview must be reviewed against that eventual release before enabling
it in a normal installation.

## Validation

The feature tests cover fresh source clones on each projection, multiple turns, duplicate text
and tool IDs both within and across agents, exact cursor matching, missing identity, failed tools, incomplete history, and repeated
expand/collapse. A host-contract harness applies Paseo's default source IDs and checks the actual
number of projected cells, including empty replacements. It also verifies that state settles
without renderer-driven invalidation.

The synthetic provider in `test/fixtures/turn-work-provider` can create a turn without a model or
external requests. Use it only in a disposable Paseo home and port. On an unmodified 0.15.4 host,
the expected behavior is normal enhanced rows with no folding. A supported-host streaming,
expand/collapse, wide/compact, theme, and reconnect smoke check is still required before release.

Collapsed source rows are absent from the host's projected timeline, so find/navigation cannot
reveal their contents until the group is expanded. Host-native grouping would be needed to
provide transparent find-and-expand behavior.
