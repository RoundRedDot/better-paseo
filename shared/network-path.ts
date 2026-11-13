/**
 * Windows network shares and device namespaces.
 *
 * Resolving `\\host\share` (or `//host/share`) already opens an SMB session on
 * Windows, so previewing a path an agent wrote would hand the daemon's NTLM
 * response to whoever owns that name, whether or not anything exists there.
 * `\\.\` names devices and `\\?\` names both devices and shares (`\\?\UNC\…`),
 * so the leading pair of separators covers those. The single-separator
 * `\??\` (also written `/??/`) is the same namespace in its short form, so it
 * is matched separately; `\\??\` already starts with two separators.
 *
 * The daemon refuses these before any filesystem call; the client refuses them
 * too, so it never asks and never renders a preview that cannot work.
 */
export function isNetworkOrDevicePath(path: string): boolean {
  const trimmed = path.trim();
  return /^[\\/]{2}/.test(trimmed) || /^[\\/]\?\?[\\/]/.test(trimmed);
}
