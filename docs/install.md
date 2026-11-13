# Installation

**English** | [简体中文](install-zh.md)

[← Back to README](../README.md)

## Marketplace Install

```bash
paseo plugin install roundreddot/better-paseo
```

Paseo `>=0.14.0` is required; the published performance measurements use Paseo 0.13.0. See
[Compatibility](limitations.md#compatibility) for version compatibility notes. Open **Settings → Plugins →
Better Paseo** (the page is titled **Settings**) to configure it. That command installs from the
plugin marketplace, which pins a reviewed revision of this GitHub repository and builds the client
on install. Updates follow that pin, not the default branch:

```bash
paseo plugin update better-paseo        # reviews the update and asks
paseo plugin update better-paseo --yes  # applies it without asking
```

## Git Source Install

To run the repository's default branch instead, replace the marketplace install with the Git
source. A plugin ID holds one source, so remove it first; removing also deletes this plugin's saved
settings, so note them and set them again after installing:

```bash
paseo plugin remove better-paseo
paseo plugin install github:RoundRedDot/better-paseo
```

The Git source tracks the repository's default branch (`main`), so the same `paseo plugin update`
later picks up a pushed commit.
