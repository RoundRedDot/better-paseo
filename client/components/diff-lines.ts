/**
 * File line numbers for the rows of a unified diff (S7 design spec §3.1:
 * "number column · sign · text"). A row counted from 1 says nothing about the
 * file; the hunk header does. Removed rows carry the old file's number, added
 * and context rows the new file's, and chrome rows (`@@`, `---`, `+++`,
 * `diff --git`, `\ No newline`) carry none. Rows before the first hunk header
 * — a bare `+`/`-` list with no header — fall back to their position.
 */

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function diffLineNumbers(lines: readonly string[]): Array<number | null> {
  const out: Array<number | null> = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const hunk = HUNK_RE.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      out.push(null);
      continue;
    }
    if (!inHunk) {
      const chrome =
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line === "---" ||
        line === "+++" ||
        line.startsWith("diff ") ||
        line.startsWith("index ");
      out.push(chrome ? null : index + 1);
      continue;
    }
    if (line.startsWith("\\")) {
      out.push(null);
    } else if (line.startsWith("-")) {
      out.push(oldLine);
      oldLine += 1;
    } else if (line.startsWith("+")) {
      out.push(newLine);
      newLine += 1;
    } else {
      out.push(newLine);
      oldLine += 1;
      newLine += 1;
    }
  }
  return out;
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
