Better Paseo redraws agent conversations as compact rows for tool calls, reasoning, replies, prompts, checklists and errors. It adds a Tasks board that groups agents by state and works across desktop, web, phones and tablets.

Tool calls start collapsed. The timeline offers syntax highlighting, streaming Markdown, block details, previews and copying, including table-cell selection. The Tasks board supports search and filters, agent details, stop and archive actions, permission responses, and manual or model-generated titles. Available actions and selection controls vary by platform and host capabilities.

## Setup and settings

Paseo 0.12.0 or later is required. No separate service account is needed. Settings control reply rendering, fonts, previews and the Tasks board, including an optional provider, model and prompt for title generation. Turning off plugin Markdown returns reply rendering to Paseo, including Mermaid and its file links.

## Data access and limits

The plugin reads displayed conversations, tool results, agent metadata and host appearance settings. Syntax highlighting sends displayed code to the daemon. Image previews can read files on the daemon; desktop file links can open files or reveal them in the file manager. Presentation and most board settings are shared by clients connected to the daemon.

When title generation is requested, excerpts of the conversation and the configured prompt are sent to a helper agent using the selected provider and model. The helper uses the provider's configured permissions; the instruction not to use tools is not a sandbox. The plugin records recent turn timing, token usage and errors on the daemon and reads provider session files for available running token counts. Some board actions use the Paseo CLI or a local daemon connection and are unavailable when those capabilities are missing.
