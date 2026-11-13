# Troubleshooting

**English** | [简体中文](troubleshooting-zh.md)

[← Back to README](../README.md)

<a id="troubleshooting"></a>

| Symptom | What to do |
| --- | --- |
| Rows overlap, or a reply overlaps the row below | Turn off **Tight rows** or **Tight reply**. |
| A reply needs a host image or Paseo's file links | Turn off **Plugin markdown for replies**. |
| A selected table cell has no **Add to chat** action on a phone | Paseo does not yet let plugins write into the composer; **Copy selected** is always available. |
| A prompt with an attachment should use Paseo's renderer | Turn off **Enhanced prompt bubble**. Attachments the plugin cannot render stay with Paseo automatically. |
| Ctrl/Cmd+F misses old messages | Scroll up to load them, or hand replies back to Paseo as above. |
| Token figures are missing on an old turn | The plugin's server records usage for every completed turn from when it was installed; turns before that, failed or cancelled turns, and turns whose provider reported no figures have none. The latest turn can also recover usage from the daemon's snapshot. |
| Pinched text in the drawer is too large or small on another phone | The size is shared by every client of the daemon; pinch again, or press **Reset** on the badge. |
| Grok and Cursor replayed turns have no elapsed time in the Copy toolbar or turn details | Upstream tool issue: when the daemon reloads a Grok or Cursor history, the records carry no per-message timestamps, so every replayed record shares the load time or differs by 1 ms, producing a misleading `0s`. Better Paseo hides an elapsed time under one second for the `grok` and `cursor` providers; turns they run live keep their elapsed time. This is based on the provider, not the model name. |
| A phone shows "This plugin surface is unavailable." | The app lost its connection; the screen returns when it reconnects ([#7088](https://github.com/getpaseo/paseo/issues/7088)). |
| Nothing changed after pushing a fix | A marketplace install only picks up a revision published there: wait for the next pin and run `paseo plugin update better-paseo`. A Git-source install follows the default branch, so the same command picks up the push. Switching from the marketplace to the Git source means removing the plugin first, which also deletes its saved settings ([Install](install.md)). |
