/** Group titles already published as plain labels. A `# ` prefix marks any later title. */
const RELEASE_NOTE_GROUP_TITLES = new Set(["时间线", "Timeline", "任务面板", "Task panel"]);

/** A version's notes are one flat list. These lines are group titles; every other line is a bullet. */
export function releaseNoteLine(item: string): { kind: "heading" | "bullet"; text: string } {
  const title = /^#\s+(\S.*)$/.exec(item.trim())?.[1]?.trim();
  if (title) return { kind: "heading", text: title };
  const text = item.trim();
  if (RELEASE_NOTE_GROUP_TITLES.has(text)) return { kind: "heading", text };
  return { kind: "bullet", text: item };
}
