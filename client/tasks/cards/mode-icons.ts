import { normalizeProvider } from "../../components/provider-logo";

/**
 * The composer's mode icons (paseo v0.12.0 `agent-controls/icons.ts`, whose
 * `getAgentModeIcon` reads `getModeVisuals` from the protocol's provider
 * manifest, which a plugin client cannot import). The card only carries the
 * mode's label, so the manifest is copied here as provider -> label ->
 * Lucide name; the labels are unique within a provider. Unknown modes draw
 * Bot, as the host does.
 */
const MODE_ICONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  claude: {
    "Plan Mode": "ShieldEllipsis",
    "Always Ask": "Shield",
    "Accept File Edits": "ShieldPlus",
    "Auto mode": "ShieldCheck",
    Bypass: "ShieldOff",
  },
  codex: {
    "Default Permissions": "Shield",
    "Auto-review": "ShieldCheck",
    "Full Access": "ShieldOff",
  },
  copilot: {
    Agent: "Shield",
    Plan: "ShieldEllipsis",
    "Allow All": "ShieldOff",
  },
  opencode: {
    Build: "Shield",
    Plan: "ShieldEllipsis",
  },
  omp: {
    "Full Access": "ShieldOff",
    "Write Approval": "ShieldAlert",
    "Always Ask": "ShieldCheck",
  },
};

/** The host's thinking icon (`ThinkingIcon`). */
export const THINKING_ICON = "Brain";

/** The Lucide name for a mode, as the composer draws it. */
export function modeIcon(provider: string, modeLabel: string): string {
  const own = MODE_ICONS[provider] ?? MODE_ICONS[normalizeProvider(provider)];
  if (own?.[modeLabel]) return own[modeLabel]!;
  for (const modes of Object.values(MODE_ICONS)) if (modes[modeLabel]) return modes[modeLabel]!;
  return "Bot";
}
