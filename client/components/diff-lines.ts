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
