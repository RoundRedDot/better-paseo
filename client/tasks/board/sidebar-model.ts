import { Platform } from "react-native";

/**
 * The desktop board's details sidebar (`docs/prototypes/task-details-sidebar.md`):
 * a column of Linear-style cards at the board's right, inline on a wide board
 * and floating over its right side on a narrow one.
 */
export const SIDEBAR = {
  /** The width it opens at, and where a double click on its edge puts it back. */
  width: 380,
  min: 340,
  max: 520,
  /** Between the lanes and the sidebar, and its margin at the board's right. */
  gap: 12,
  /** Inline from this board width; floating below `floatBelow`; between the two it keeps its mode. */
  inlineFrom: 1020,
  floatBelow: 996,
  /** What an inline sidebar leaves the lanes at least: two lanes at their scroll width and the edges. */
  lanesMin: 612,
  /** At most this many cards to go back through. */
  history: 20,
} as const;

export type SidebarMode = "inline" | "floating";

/** Inline or floating for a board this wide, keeping the current mode inside the 24 px band. */
export function sidebarMode(boardWidth: number, current: SidebarMode | null): SidebarMode {
  if (boardWidth >= SIDEBAR.inlineFrom) return "inline";
  if (boardWidth < SIDEBAR.floatBelow) return "floating";
  return current ?? "inline";
}

/** The sidebar's width: the user's, made narrower (down to the minimum) when an inline one would squeeze the lanes. */
export function sidebarWidth(boardWidth: number, preferred: number, mode: SidebarMode): number {
  const wanted = clampWidth(preferred);
  if (mode === "floating") return Math.min(wanted, Math.max(SIDEBAR.min, boardWidth - 2 * SIDEBAR.gap));
  return Math.max(SIDEBAR.min, Math.min(wanted, boardWidth - SIDEBAR.gap - SIDEBAR.lanesMin));
}

export function clampWidth(width: number): number {
  return Math.round(Math.max(SIDEBAR.min, Math.min(SIDEBAR.max, width)));
}

/** Which card the sidebar shows, and the cards to go back to. */
export interface SidebarSelection {
  id: string | null;
  /** Earlier cards, newest last, for the back row after a parent or subtask jump. */
  back: string[];
}

export const NO_SELECTION: SidebarSelection = { id: null, back: [] };

export type SelectionAction =
  /** A click or tap on a card: the only way a board card reaches the sidebar. */
  | { type: "click"; id: string }
  /** A parent or subtask link in the sidebar: shown, the current one kept to go back to. */
  | { type: "jump"; id: string }
  | { type: "back" }
  | { type: "clear" };

export function selectionReducer(state: SidebarSelection, action: SelectionAction): SidebarSelection {
  switch (action.type) {
    case "click":
      if (state.id === action.id && state.back.length === 0) return state;
      return { id: action.id, back: [] };
    case "jump":
      if (state.id === action.id) return state;
      return { id: action.id, back: state.id ? [...state.back, state.id].slice(-SIDEBAR.history) : state.back };
    case "back": {
      if (state.back.length === 0) return state;
      return { id: state.back[state.back.length - 1] ?? null, back: state.back.slice(0, -1) };
    }
    case "clear":
      return state.id === null ? state : NO_SELECTION;
  }
}

/** What Esc does to the sidebar, in order: go back, close the floating panel, let go of the card; null when it has nothing to undo. */
export function escapeStep(selection: SidebarSelection, floatingOpen: boolean): "back" | "close" | "clear" | null {
  if (selection.back.length > 0) return "back";
  if (floatingOpen) return "close";
  if (selection.id !== null) return "clear";
  return null;
}

/** Whether the board shows its sidebar, and how wide, as the user left it. Session memory everywhere, web storage across reloads. */
export interface SidebarPreference {
  open: boolean;
  width: number;
}

const STORAGE_KEY = "paseo/better-chat/tasks/sidebar/v1";
const DEFAULT_PREFERENCE: SidebarPreference = { open: true, width: SIDEBAR.width };
let remembered: SidebarPreference | null = null;

function storage(): Storage | null {
  if (Platform.OS !== "web") return null;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readSidebarPreference(): SidebarPreference {
  if (remembered) return remembered;
  let read: SidebarPreference = DEFAULT_PREFERENCE;
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SidebarPreference>;
      read = {
        open: typeof parsed.open === "boolean" ? parsed.open : DEFAULT_PREFERENCE.open,
        width: typeof parsed.width === "number" && Number.isFinite(parsed.width) ? clampWidth(parsed.width) : DEFAULT_PREFERENCE.width,
      };
    }
  } catch {
    // A broken entry reads as the default.
  }
  remembered = read;
  return read;
}

export function writeSidebarPreference(next: SidebarPreference): void {
  remembered = next;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the session still remembers.
  }
}

/** Tests only. */
export function resetSidebarPreference(): void {
  remembered = null;
}
