/** Bound both native text layout and the number of attributed fragments. */
export const TEXT_CHUNK_LINES = 64;
/** Diff rows carry both syntax runs and semantic fills. */
export const DIFF_TEXT_CHUNK_LINES = 16;
export const TEXT_CHUNK_CHARS = 8192;

export interface TextChunk {
  /** First source line, and character offset within it for a long line. */
  from: number;
  offset: number;
  lines: readonly string[];
  text: string;
}

/** Source lines stay intact except when one line exceeds the character budget. */
export function textChunks(lines: readonly string[], lineLimit = TEXT_CHUNK_LINES): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;
  let size = 0;
  const flush = (to: number) => {
    if (to === start) return;
    const part = lines.slice(start, to);
    chunks.push({ from: start, offset: 0, lines: part, text: part.join("\n") });
    start = to;
    size = 0;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.length > TEXT_CHUNK_CHARS) {
      flush(index);
      for (let offset = 0; offset < line.length;) {
        let end = Math.min(line.length, offset + TEXT_CHUNK_CHARS);
        // Keep a UTF-16 surrogate pair in the same native text view.
        if (end < line.length && line.charCodeAt(end - 1) >= 0xd800 && line.charCodeAt(end - 1) <= 0xdbff) end--;
        const text = line.slice(offset, end);
        chunks.push({ from: index, offset, lines: [text], text });
        offset = end;
      }
      start = index + 1;
      continue;
    }
    if (index - start >= lineLimit || size + line.length + (index > start ? 1 : 0) > TEXT_CHUNK_CHARS) flush(index);
    size += line.length + (index > start ? 1 : 0);
  }
  flush(lines.length);
  return chunks;
}
