# What a Plugin Cannot Do

**English** | [简体中文](limitations-zh.md)

[← Back to README](../README.md)

<a id="what-a-plugin-cannot-do"></a>

Better Paseo draws only what the Paseo plugin SDK lets a plugin draw. The items below are things
you might expect that it cannot do, or does only by going around the SDK, on released Paseo (checked against `@getpaseo/plugin` 0.12.0
and 0.13.0-beta.1 on 2026-10-23), what it does instead, and the upstream change each one waits
for. Upstream states are as of the same date.

## In the timeline

| Cannot | Instead | Waiting on |
| --- | --- | --- |
| Open a pressed file in Paseo's file panel. Plugins get no navigation to a file; 0.13 lets a plugin add a file viewer, but still not open a file. | Desktop opens it in its default app or reveals it in Finder or Explorer; touch copies the path ([Opening files](../README.md#opening-files)). | [getpaseo/paseo#7318](https://github.com/getpaseo/paseo/pull/7318), open |
| Show the images pasted into a prompt. Paseo strips them from the item a plugin receives. | **Enhanced prompt bubble** is off by default, so Paseo keeps the prompt and its images; when on, a prompt with an attachment the plugin cannot draw stays with Paseo. | [#6736](https://github.com/getpaseo/paseo/pull/6736), open draft |
| Offer Paseo's rewind menu on the plugin's prompt bubble, or its Fork action on the plugin's reply footer. A plugin replaces a row whole and cannot borrow the host's menus. | Turn **Enhanced prompt bubble** off for rewind, **Plugin markdown for replies** off for Fork. | [#6677](https://github.com/getpaseo/paseo/pull/6677) (rewind), [#7462](https://github.com/getpaseo/paseo/pull/7462) (fork), open |
| Let Paseo's Ctrl/Cmd+F reveal a row the plugin drew. | The plugin's own find bar, over loaded messages ([Finding text](../README.md#finding-text)). | nothing filed |
| Space its rows like Paseo's native tool rows. Paseo puts a 16pt gap under each plugin row. | **Tight rows** and **Tight reply** take most of it back where it is safe. | [#6602](https://github.com/getpaseo/paseo/pull/6602), open |
| Follow a font change in Paseo's Appearance settings live. Paseo does not share its font settings with plugins. | Web and desktop read the font Paseo saved on that computer; iOS and Android use the system monospace at 12px under Follow Paseo. | not proposed upstream yet |
| Offer **Add to chat** for a table selection on iOS and Android. Plugins cannot write into Paseo's composer. | **Copy selected**. On web the plugin inserts the text into the composer itself. | not proposed upstream yet |
| Pin the current prompt, or an open card's header, to the top while you scroll. | The plugin side is ready and turns on once Paseo offers it. | not proposed upstream yet |
| Group several calls into one "Read 12 files" row. Paseo folds runs of calls under its Summary tool-call display, but skips plugin rows. | Rows stay one per call. | [Discussion #7687](https://github.com/getpaseo/paseo/discussions/7687), open |
| Scroll a 5,000-line block quickly (about 30 s to open on a development-build simulator). | Long output folds to 12 lines and renders in batches. | no host API |
| Show token figures for turns from before the plugin was installed. Paseo keeps usage only on live events. | The plugin's server records every turn's start, end, error and usage from the moment it runs, so turns since then show figures on any client. | [#7000](https://github.com/getpaseo/paseo/pull/7000) (turn timing), open |
| Leave the timeline usable behind the details panel on iOS and Android. A plugin overlay there is a full-screen modal. | The floating and side panels close on a tap outside; on web they are not modal. | nothing filed |

## On the Tasks board

Several board features have no plugin API yet. They work on released Paseo 0.12 because the
plugin's server goes around the SDK: it runs Paseo's CLI on the daemon's machine, or opens its own
connection to the daemon through the client modules Paseo installs. These are stopgaps; each
switches to an official API once Paseo has one.

| Feature | How it works today | Waiting on |
| --- | --- | --- |
| Label colours and project icons | The plugin's server reads the label definitions and project icons from the daemon (`tasks.labels`, `tasks.project-icons`). The board asks the plugin API first, so on a Paseo that exposes them it uses the official calls by itself. If neither answers, labels take a colour picked by their name and projects a generated initial. | [#7482](https://github.com/getpaseo/paseo/pull/7482), open ([Discussion #7481](https://github.com/getpaseo/paseo/discussions/7481)) |
| Stop | Runs `paseo agent stop`; hidden where the CLI is not found. | nothing filed |
| Unarchive | Runs `paseo agent reload`; hidden where the CLI is not found. | nothing filed |
| Mark as read | Clears the agent's attention over the server's own daemon connection; hidden where that connection is unavailable. | [#7647](https://github.com/getpaseo/paseo/pull/7647) (a CLI command), open |
| Provider sub-agent cards | The server reads a session's sub-agents from the daemon and follows their updates; without the connection the board shows none. | nothing filed |

Archive needs no workaround: it uses the plugin API.

| Cannot | Instead | Waiting on |
| --- | --- | --- |
| Open an archived task's tab. A plugin cannot pin the tab it opens, so Paseo drops an archived agent's tab and shows another of that workspace. | An archived task shows **Unarchive** where Open was; once it is back, Open works. Tasks of an archived workspace keep Open. | [#6382](https://github.com/getpaseo/paseo/pull/6382), open draft |

## Everywhere

| Cannot | Instead | Waiting on |
| --- | --- | --- |
| Keep a plugin screen while the phone is disconnected. Paseo removes every plugin when the connection drops and sends all their bundles again on reconnect, so an open board shows "This plugin surface is unavailable." until it is back. | The board returns with its cards, lane and filters; the bundle is minified and the board loads on demand, so the catalog fell from 1,977 KB to 722 KB (measured on a Paseo 0.12 daemon when the change landed). | [#7088](https://github.com/getpaseo/paseo/issues/7088) (issue), [#6731](https://github.com/getpaseo/paseo/pull/6731), [#6732](https://github.com/getpaseo/paseo/pull/6732), open |
| Keep a setting per device. Plugin settings are host-wide only. | Every client of a daemon shares one set, the drawer's pinch size included. | nothing filed |

The SDK constraints met while building the plugin, with evidence and workarounds, are listed for
developers in [`docs/plugin-sdk-limitations.md`](plugin-sdk-limitations.md).

<a id="paseo-issues-the-plugin-works-around"></a>

## Paseo issues the plugin works around

| Issue | What the plugin does | Fix |
| --- | --- | --- |
| A background sub-agent from an earlier turn makes Paseo 0.12 draw a later tool call twice. | Hides the copies and the gap they leave. | [#7541](https://github.com/getpaseo/paseo/issues/7541) / [#7543](https://github.com/getpaseo/paseo/pull/7543), open |
| A Claude turn that hits the session limit (or an invalid key) ends as a normal reply, and the agent looks done. | The Tasks board files it under to review as failed, with its error. | [#7636](https://github.com/getpaseo/paseo/issues/7636) / [#7637](https://github.com/getpaseo/paseo/pull/7637), open |
| Grok and Cursor histories reload without per-message times. | Hides an elapsed time under one second for those providers; live turns keep theirs. | provider-side |

<a id="compatibility"></a>

## Compatibility

Better Paseo requires Paseo 0.14.0 or later. The Tasks board uses its background-workspace
discovery API to keep a parent running while its hidden child tasks are still active.
The performance measurements were made on Paseo 0.13.0 and have not been repeated on 0.14.0 (see [Performance Benchmarks](performance.md)).
