export const DEFAULT_OPEN_TASKS_SHORTCUT = "Mod+Shift+KeyY";
const KEY = /^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|Space|Enter|Backspace|Delete|Backquote|BracketLeft|BracketRight|Comma|Period|Slash|Semicolon|Quote|Backslash|Minus|Equal)$/;

type ShortcutInput = Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export function shortcutFromEvent(event: ShortcutInput, mac: boolean): string | null {
  if (!KEY.test(event.code) || !(event.metaKey || event.ctrlKey || event.altKey)) return null;
  return [
    (mac ? event.metaKey : event.ctrlKey) ? "Mod" : null,
    (mac ? event.ctrlKey : event.metaKey) ? (mac ? "Ctrl" : "Meta") : null,
    event.altKey ? "Alt" : null,
    event.shiftKey ? "Shift" : null,
    event.code,
  ].filter(Boolean).join("+");
}

export function validTasksShortcut(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  const parts = value.split("+");
  return KEY.test(parts.at(-1)!) && parts.length > 1 && parts.slice(0, -1).every((part) => ["Mod", "Ctrl", "Meta", "Alt", "Shift"].includes(part)) && new Set(parts).size === parts.length && parts.some((part) => ["Mod", "Ctrl", "Meta", "Alt"].includes(part));
}

export function shortcutLabel(shortcut: string, mac: boolean): string {
  return shortcut.split("+").map((part) => {
    if (part === "Mod") return mac ? "Command" : "Ctrl";
    if (part === "Alt") return mac ? "Option" : "Alt";
    return part.replace(/^Key|^Digit/, "");
  }).join(" + ");
}
