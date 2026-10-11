/**
 * Path display (plan §3.9, BC-13).
 *
 * A tool reports whatever path it was handed: absolute, relative to the agent,
 * Windows or POSIX, often with a selector such as `:12` or `#L10` glued on.
 * `formatPath` turns that into what a reader wants to see — the path relative
 * to the workspace — while keeping the absolute path for reveal and copy.
 *
 * Pure and platform-free: no `path` module, no realpath. Matching is by whole
 * segments, so `/projects/app-backup/x` never counts as inside `/projects/app`.
 */

export type PathDisplayMode = "relative" | "absolute";

/** A root a path can be shown relative to. Only secondary roots carry a label. */
export interface PathRoot {
  path: string;
  label?: string;
}

export interface FormatPathContext {
  /** In priority order; the first root that contains the path wins. */
  roots: readonly PathRoot[];
  /** Base for relative input, the same one the daemon resolves against. */
  cwd?: string;
  mode: PathDisplayMode;
}

export interface FormattedPath {
  /** For reveal and copy. Equal to the input when nothing is known to resolve it against. */
  absolutePath: string;
  /** What to draw before `suffix`. Includes the label of a secondary root. */
  displayPath: string;
  /** The label of the secondary root that matched, drawn muted; null otherwise. */
  label: string | null;
  /** The root that matched, normalised; null when none did. */
  projectRoot: string | null;
  /** The selector split off the input (`:12`, `:12:3`, `#L10`, `?raw`), or "". */
  suffix: string;
}

const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;
const BARE_DRIVE = /^[a-zA-Z]:$/;

/**
 * Splits a trailing selector off a path, by the same rule the daemon's
 * `stripSelector` uses before it reveals a file: the path ends at the first
 * whitespace, `:`, `?` or `#` after any drive letter.
 */
export function splitSelector(raw: string): { path: string; suffix: string } {
  const trimmed = raw.trim();
  const head = WINDOWS_DRIVE.test(trimmed) ? trimmed.slice(0, 3) : "";
  const tail = trimmed.slice(head.length);
  const cut = tail.search(/[\s:?#]/);
  if (cut === -1) return { path: trimmed, suffix: "" };
  return { path: head + tail.slice(0, cut), suffix: tail.slice(cut) };
}

function isWindowsPath(path: string): boolean {
  return WINDOWS_DRIVE.test(path) || BARE_DRIVE.test(path) || /^[\\/]{2}[^\\/]/.test(path);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\") || isWindowsPath(path);
}

/**
 * `\` to `/`, `.` and empty segments dropped, `..` folded, no trailing `/`.
 * The root part (`/`, `C:/`, `//server/`) survives, and `..` never climbs
 * above it.
 */
export function normalizePath(input: string): string {
  const slashed = input.replace(/\\/g, "/");
  let root = "";
  let rest = slashed;
  const drive = /^([a-zA-Z]:)(\/|$)/.exec(slashed);
  if (drive) {
    root = `${drive[1]}/`;
    rest = slashed.slice(drive[0].length);
  } else if (/^\/\/[^/]/.test(slashed)) {
    root = "//";
    rest = slashed.slice(2);
  } else if (slashed.startsWith("/")) {
    root = "/";
    rest = slashed.slice(1);
  }

  const out: string[] = [];
  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!root) out.push("..");
      continue;
    }
    out.push(segment);
  }
  const joined = out.join("/");
  if (!root) return joined || ".";
  return root + joined;
}

/** The part of `path` below `root`, "" when they are equal, null when outside. */
function relativeTo(path: string, root: string, ignoreCase: boolean): string | null {
  const a = ignoreCase ? path.toLowerCase() : path;
  const b = ignoreCase ? root.toLowerCase() : root;
  if (a === b) return "";
  const prefix = b.endsWith("/") ? b : `${b}/`;
  return a.startsWith(prefix) ? path.slice(prefix.length) : null;
}

export function formatPath(raw: string, ctx: FormatPathContext): FormattedPath {
  const { path, suffix } = splitSelector(raw);
  const unmatched = (absolutePath: string, displayPath: string): FormattedPath => ({
    absolutePath,
    displayPath,
    label: null,
    projectRoot: null,
    suffix,
  });

  if (!path) return unmatched(raw.trim(), raw.trim());

  // Relative input is drawn as written: it is already short, and it is what
  // the model typed. Only the absolute form is resolved, for reveal and copy.
  if (!isAbsolutePath(path)) {
    const absolutePath = ctx.cwd ? normalizePath(`${ctx.cwd}/${path}`) : path;
    return unmatched(absolutePath, ctx.mode === "absolute" && ctx.cwd ? absolutePath : path);
  }

  const absolutePath = normalizePath(path);
  if (ctx.mode === "absolute") return unmatched(absolutePath, absolutePath);

  const ignoreCase = isWindowsPath(absolutePath);
  for (const root of ctx.roots) {
    if (!root.path || !isAbsolutePath(root.path)) continue;
    const rootPath = normalizePath(root.path);
    const rest = relativeTo(absolutePath, rootPath, ignoreCase);
    if (rest === null) continue;
    const label = root.label ?? null;
    const displayPath = label ? `${label}/${rest}` : rest || "./";
    return { absolutePath, displayPath, label, projectRoot: rootPath, suffix };
  }
  // Outside every root, or a symlinked spelling of one: no realpath here, so
  // the absolute path is the honest answer.
  return unmatched(absolutePath, absolutePath);
}

/** Last segment of a normalised path; the path itself when it has none. */
export function baseName(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1) || normalized;
}

/**
 * The roots for one agent (plan §3.9 item 2): the workspace directory first
 * (a worktree is its own path), then the project root labelled with the
 * project name when it differs, and the agent cwd only when neither is known.
 */
export function pathRootsFor(input: {
  directory?: string | null;
  projectRootPath?: string | null;
  projectDisplayName?: string | null;
  cwd?: string | null;
}): PathRoot[] {
  const roots: PathRoot[] = [];
  const directory = input.directory || null;
  const project = input.projectRootPath || null;
  if (directory) roots.push({ path: directory });
  if (project && (!directory || normalizePath(project) !== normalizePath(directory))) {
    if (directory) {
      roots.push({ path: project, label: input.projectDisplayName || baseName(project) });
    } else {
      roots.push({ path: project });
    }
  }
  if (roots.length === 0 && input.cwd) roots.push({ path: input.cwd });
  return roots;
}
