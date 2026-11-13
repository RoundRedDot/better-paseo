# Turn-work integration fixture

This provider emits synthetic thoughts, tools, failures and final replies without a model or
external requests. Install it only in a disposable Paseo home. Its recorded history and plugin
settings must be separate from the normal desktop daemon.

Configure a disposable daemon home and an unused loopback port using the
[Paseo daemon configuration guide](https://paseo.sh/docs/configuration). From this checkout,
install both this provider and Better Paseo into that home. Always pass `--home` when installing,
inspecting or reloading the scratch instance:

```sh
paseo plugin install ./test/fixtures/turn-work-provider --home /absolute/path/to/scratch-home
paseo plugin install . --home /absolute/path/to/scratch-home
paseo plugin ls --home /absolute/path/to/scratch-home --json
paseo plugin reload turn-work-fixture --home /absolute/path/to/scratch-home
```

Create an agent using `turn-work-fixture/fixture` in the scratch UI and send any message. A turn
contains 12 thoughts and 12 tools; tools 4 and 9 fail, and the final reply stays visible. Include
`slow` in the prompt to observe each running tool before it settles, or `long` for 80 thoughts
and 80 tools. These fixture commands are synthetic and do not execute shell commands.

The fixture deliberately reuses call IDs and thought text across separate agents so tests can
check that folding never crosses agent boundaries. Thought text also repeats across turns;
canonical timeline cursors must keep those records in their own turns.

Paseo 0.15.4 does not pass stable agent/source/cursor identity to plugin transformers. The guarded
implementation must leave all enhanced work rows visible on that host, even if the preference
is enabled. Actual grouped folding requires the proposed host identity-context patch. Do not
treat a successful plugin reload on 0.15.4 as validation of folding.

After typechecking, reload the candidate only on the scratch home. Check one normal turn,
one slow turn while running, a long turn while scrolling, a second agent with identical work,
and expansion/collapse followed by a page reload. Watch for duplicate row IDs, repeated tool
content, missing replies, blank cell gaps, and continuing re-projection after the turn settles.

`test/unit/turn-work-host.test.ts` models the host's input cloning, replacement flattening and
row ID rules. It checks bounded projection changes and the old-host fallback; it does not
replace browser or native layout verification.
