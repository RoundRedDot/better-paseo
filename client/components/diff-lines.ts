/**
 * File line numbers for the rows of a unified diff (S7 design spec §3.1:
 * "number column · sign · text"). A row counted from 1 says nothing about the
 * file; the hunk header does. Removed rows carry the old file's number, added
 * and context rows the new file's, and chrome rows (`@@`, `---`, `+++`,
 * `diff --git`, `\ No newline`) carry none. Rows before the first hunk header
 * — a bare `+`/`-` list with no header — fall back to their position.
 */

/** Unified and combined hunks carry one range per parent, then the result. */
export function diffHunk(line: string): { starts: number[]; counts: number[] } | null {
  const match = /^(@{2,}) ((?:-\d+(?:,\d+)? )+)\+(\d+)(?:,(\d+))? \1(?:\s|$)/.exec(line);
  if (!match) return null;
  const parents = [...match[2]!.matchAll(/-(\d+)(?:,(\d+))?/g)];
  if (parents.length !== match[1]!.length - 1) return null;
  return {
    starts: [...parents.map((range) => Number(range[1])), Number(match[3])],
    counts: [...parents.map((range) => Number(range[2] ?? 1)), Number(match[4] ?? 1)],
  };
}

export interface DiffRow {
  number: number | null;
  markers: string;
  kind: "add" | "remove" | null;
}

/** Columns consumed by a body row: combined deletions exist only in marked parents. */
function consumedColumns(markers: string): boolean[] {
  const removed = markers.includes("-");
  return [...Array.from(markers, (marker) => removed ? marker === "-" : marker !== "+"), !removed];
}

export function diffRows(lines: readonly string[]): DiffRow[] {
  let positions: number[] | null = null;
  let parents = 1;
  let remaining: number[] | null = null;
  return lines.map((line, index) => {
    const hunk = diffHunk(line);
    if (hunk) {
      positions = hunk.starts;
      remaining = hunk.counts;
      parents = positions.length - 1;
      return { number: null, markers: "", kind: null };
    }
    const inBody = remaining?.some((count) => count > 0) && /^[ +\-]+$/.test(line.slice(0, parents));
    if (!inBody && /^(?:diff |index |---(?: |$)|\+\+\+(?: |$)|\\|new file |deleted file |old mode |new mode |mode |similarity |dissimilarity |rename |copy |Binary |GIT binary)/.test(line)) {
      if (line.startsWith("diff ")) { positions = null; parents = 1; }
      return { number: null, markers: "", kind: null };
    }
    const markers = line.slice(0, parents);
    if (markers.length !== parents || !/^[ +\-]+$/.test(markers)) {
      return { number: positions ? null : index + 1, markers: "", kind: null };
    }
    const consumed = consumedColumns(markers);
    const removed = markers.includes("-");
    const number = positions
      ? positions[removed ? consumed.indexOf(true) : parents] ?? null
      : index + 1;
    positions?.forEach((_, column) => {
      if (consumed[column]) { positions![column]! += 1; if (remaining) remaining[column]! -= 1; }
    });
    return { number, markers, kind: removed ? "remove" : markers.includes("+") ? "add" : null };
  });
}

export function diffLineNumbers(lines: readonly string[]): Array<number | null> {
  return diffRows(lines).map((row) => row.number);
}

export interface OutputSection {
  text: string;
  diff: boolean;
  filename?: string;
}

/** Split patches from subsequent command output using the hunk's declared ranges. */
export function splitDiffOutput(text: string): OutputSection[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const sections: OutputSection[] = [];
  let current: OutputSection | undefined;
  let remaining: number[] | null = null;
  let binary = false;
  const append = (line: string, diff: boolean, start = false) => {
    if (!current || current.diff !== diff || start) {
      current = { text: line, diff };
      sections.push(current);
    } else current.text += `\n${line}`;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const file = /^diff --(?:git|cc|combined) /.test(line);
    const pair = line.startsWith("--- ") && (lines[index + 1] ?? "").startsWith("+++ ");
    const hunk = diffHunk(line);
    // Inside a hunk, source text can itself resemble a file header.
    if (remaining?.some((count) => count > 0) && !hunk && !file && !line.startsWith("\\")) {
      const markers = line.slice(0, remaining.length - 1);
      if (markers.length === remaining.length - 1 && /^[ +\-]+$/.test(markers)) {
        append(line, true);
        consumedColumns(markers).forEach((consumed, column) => { if (consumed) remaining![column]! -= 1; });
        continue;
      }
    }
    if (file || pair || hunk) {
      append(line, true, file || (pair && (!current?.diff || remaining !== null)));
      remaining = hunk?.counts ?? null;
      binary = false;
    } else if (current?.diff && (/^(?:index |--- |\+\+\+ |\\ No newline|new file mode |deleted file mode |old mode |new mode |mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |Binary files |GIT binary patch)/.test(line)
      || (binary && line !== ""))) {
      append(line, true);
      if (line === "GIT binary patch") binary = true;
    } else {
      append(line, false);
      remaining = null;
      binary = false;
    }
    if (current?.diff && /^(?:---|\+\+\+) /.test(line) && !line.endsWith(" /dev/null")) {
      const path = line.slice(4).split("\t")[0]!;
      // Quoted Git paths may contain C escapes; do not guess their decoding.
      if (!path.startsWith('"')) current.filename = path.replace(/^[ab]\//, "");
    }
  }
  return sections;
}

/** Beyond this many line pairs the changed middle is not aligned, only replaced. */
const MAX_ALIGNED_CELLS = 4000000;

function textLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return trimmed === "" ? [] : trimmed.split("\n");
}

/**
 * A line diff of an edit's old and new text, for a provider that sends the
 * two strings and no diff (Claude's Edit, the ACP agents), as the app's own
 * edit card builds one. Rows are ` `, `-` or `+` and there is no hunk header:
 * the strings say nothing about where in the file they sit, so the rows must
 * not be numbered as file lines.
 */
export function lineDiff(oldText: string, newText: string): string {
  const before = textLines(oldText);
  const after = textLines(newText);
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  const removed = before.slice(head, before.length - tail);
  const added = after.slice(head, after.length - tail);
  const rows = before.slice(0, head).map((line) => ` ${line}`);

  const m = removed.length;
  const n = added.length;
  if (m === 0 || n === 0 || m * n > MAX_ALIGNED_CELLS) {
    for (const line of removed) rows.push(`-${line}`);
    for (const line of added) rows.push(`+${line}`);
  } else {
    // Longest common subsequence, read from the end so the walk runs forward.
    const width = n + 1;
    const common = new Uint32Array((m + 1) * width);
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        common[i * width + j] = removed[i] === added[j]
          ? common[(i + 1) * width + j + 1]! + 1
          : Math.max(common[(i + 1) * width + j]!, common[i * width + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (removed[i] === added[j]) {
        rows.push(` ${removed[i]}`);
        i += 1;
        j += 1;
      } else if (common[(i + 1) * width + j]! >= common[i * width + j + 1]!) {
        rows.push(`-${removed[i]}`);
        i += 1;
      } else {
        rows.push(`+${added[j]}`);
        j += 1;
      }
    }
    while (i < m) rows.push(`-${removed[i++]}`);
    while (j < n) rows.push(`+${added[j++]}`);
  }

  for (const line of before.slice(before.length - tail)) rows.push(` ${line}`);
  return rows.join("\n");
}
