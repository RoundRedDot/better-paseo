/**
 * Picks the session mode with the fewest permissions for a helper agent
 * (translation, title generation), so a model that ignores the "no tools"
 * system prompt still cannot act.
 */
import type { PaseoApi } from "./paseo-types";

export interface HelperModeCandidate {
  id: string;
  label?: string;
  colorTier?: string;
  isUnattended?: boolean;
}

/** Modes chosen by name for providers whose least-privilege mode is known. */
const PREFERRED_MODE_IDS: Readonly<Record<string, readonly string[]>> = {
  // Plan mode analyses without executing tools or edits.
  claude: ["plan"],
};

const READ_ONLY_ID = /^read[-_ ]?only$/i;
// Words that mark a mode as granting more than the provider's ask-first default.
const PERMISSIVE_HINT = /full|bypass|yolo|accept|auto|unattended|danger|trust|skip/i;

/** Lower is fewer permissions; `null` is never chosen. */
function permissionRank(mode: HelperModeCandidate): number | null {
  if (mode.colorTier === "dangerous" || mode.isUnattended === true) return null;
  if (READ_ONLY_ID.test(mode.id)) return 0;
  if (mode.colorTier === "planning") return 1;
  if (mode.colorTier === "safe") return 2;
  const permissive = PERMISSIVE_HINT.test(`${mode.id} ${mode.label ?? ""}`);
  if (!mode.colorTier && !permissive) return 3;
  if (mode.colorTier === "moderate") return 4;
  return permissive ? 5 : 4;
}

export function leastPrivilegeModeId(
  provider: string,
  modes: readonly HelperModeCandidate[] | null | undefined,
): string | undefined {
  if (!modes || modes.length === 0) return undefined;
  for (const id of PREFERRED_MODE_IDS[provider] ?? []) {
    if (modes.some((mode) => mode.id === id)) return id;
  }
  let best: { id: string; rank: number } | undefined;
  for (const mode of modes) {
    const rank = permissionRank(mode);
    if (rank === null) continue;
    // Ties keep the provider's listed order, which puts its default first.
    if (!best || rank < best.rank) best = { id: mode.id, rank };
  }
  return best?.id;
}

/**
 * The mode for a helper on `provider`. The providers snapshot already lists the
 * modes; they are asked for only when it does not. Unreadable modes leave the
 * mode unset rather than failing the helper.
 */
export async function resolveHelperModeId(
  paseo: PaseoApi,
  provider: string,
  listed: readonly HelperModeCandidate[] | undefined,
): Promise<string | undefined> {
  if (listed) return leastPrivilegeModeId(provider, listed);
  try {
    const result = await paseo.providers.listModes(provider);
    return result.error ? undefined : leastPrivilegeModeId(provider, result.modes);
  } catch {
    return undefined;
  }
}
