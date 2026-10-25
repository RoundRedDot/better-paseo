/**
 * Shared types for block details: tap a timeline row to read it in a bottom
 * drawer, a floating bottom panel or a right-hand panel, chosen by window width
 * (docs/prototypes/block-details-sheet.md). Every slice of the feature builds on
 * these; change them only together with their users.
 */
import { createContext, type ReactNode } from "react";

/**
 * drawer: full-width bottom sheet with a scrim (W < 600).
 * floating: centred bottom panel, min(W − 32, 760) wide (600 ≤ W < 960, or no room for a side panel).
 * side: right-hand panel, clamp(0.36W, 420, 640) wide (W ≥ 960 with room; phone landscape at 400).
 */
export type DetailsForm = "drawer" | "floating" | "side";

/** fit: as tall as the content up to 0.58 of the available height. full: available − 8. */
export type Detent = "fit" | "full";

export interface LayoutInput {
  /** The window (or Modal) width and height, in points. */
  width: number;
  height: number;
  /** Width taken by the host's left sidebar, 0 when hidden or unknown. */
  sidebar: number;
  /** A fine pointer that hovers (desktop web, iPad with a trackpad). */
  pointer: boolean;
}

export type BlockKind = "tool" | "thought" | "activity" | "todo" | "code";

/** One copy button: the preview toolbar's and the row menu's (design table 5.9). */
export interface CopyItem {
  id: string;
  /** English label; `toolbarLabel` translates it. */
  label: string;
  /** Lucide icon name. */
  icon: string;
  text: string;
}

/**
 * A previewable row as the details panel knows it. Rows register while they
 * are mounted; an unmounted row stays as a tombstone (`mounted: false`) that can
 * still be shown and stepped through, but not scrolled to.
 */
export interface BlockEntry {
  /** Stable across remounts: the row's preview memory key. */
  id: string;
  agentId: string;
  /** Timeline order: the item's timestamp (ms), then kind order, then registration order. */
  at: number;
  kind: BlockKind;
  seq: number;
  /** In the ‹ › sequence. False for code blocks and rows without a body. */
  navigable: boolean;
  hasBody: boolean;
  mounted: boolean;
  /** Header title (single line, tap to expand to 4), mono for commands and paths. */
  title: string;
  titleMono: boolean;
  /** Header subtitle parts, joined with " · ": status, duration. The index "i / n" is added by the shell. */
  subtitle: readonly string[];
  /** Status tone of the subtitle's first part. */
  tone?: "muted" | "accent" | "success" | "warning" | "danger";
  icon: string;
  iconColor?: string;
  /** The row reads an image: a tap opens the viewer instead of the panel. */
  readsImage: boolean;
  /** The preview content, the same tree the hover panel draws. */
  render(): ReactNode;
  copies(): readonly CopyItem[];
  /** The row's rectangle in window coordinates, null when unmounted. */
  measure?(): Promise<{ top: number; height: number } | null>;
  /** Run when the panel opens this block (an image read starts its fetch). */
  onOpen?(): void;
}

export interface DetailsState {
  openId: string | null;
  form: DetailsForm;
  detent: Detent;
  /** Drawer / floating at full height, or the side panel widened. */
  fullscreen: boolean;
  /** The block whose row marker lingers 1.2 s after the panel closed. */
  lingerId: string | null;
}

export interface OpenOptions {
  detent?: Detent;
  /** False for a code block: no ‹ ›, not counted. */
  navigable?: boolean;
  /** Force a form (the desktop hover's "open in panel" asks for side). */
  form?: DetailsForm;
}

export interface DetailsApi {
  open(agentId: string, id: string, options?: OpenOptions): void;
  close(agentId: string): void;
  /** Previous (-1) or next (1) navigable block. */
  step(agentId: string, direction: -1 | 1): void;
  setDetent(agentId: string, detent: Detent): void;
  setFullscreen(agentId: string, on: boolean): void;
  setForm(agentId: string, form: DetailsForm): void;
}

/** What a press on a row body does (design table 5.4). */
export type RowPressAction = "details" | "expand" | "viewer" | "close" | "none";

/** Where a row sits in the timeline. Each renderer provides it; DisclosureHeader reads it. */
export interface BlockPlacement {
  agentId: string;
  /** The timeline item's timestamp in ms. */
  at: number;
  kind: BlockKind;
}
export const BlockPlacementContext = createContext<BlockPlacement | null>(null);

/** Independent native details text size, in points (`detailsFontSize`). */
export interface DetailsZoom {
  /** The fixed default size used by Reset. */
  base: number;
  /** The size drawn now, mid-pinch included. */
  current(): number;
  /** Draws the absolute size while the fingers move, without saving it. */
  preview(zoom: number): void;
  /** Saves the absolute size as the reader's. */
  commit(zoom: number): void;
}

/**
 * What the details shell offers the chrome it draws (header, toolbar): slice B
 * provides it around the open block, `HoverPreviewHeader` reads it under
 * `PreviewChromeContext = "details"`.
 */
export interface DetailsShellValue {
  agentId: string;
  entry: BlockEntry;
  form: DetailsForm;
  detent: Detent;
  fullscreen: boolean;
  /** Pointer metrics (header 44, buttons 28, toolbar 36) instead of touch (52, 36, 44). */
  pointer: boolean;
  /** 1-based position among navigable blocks, 0 when the block is not navigable. */
  index: number;
  count: number;
  canStep: { previous: boolean; next: boolean };
  step(direction: -1 | 1): void;
  close(): void;
  /** Drawer / floating: fit to full and back, offered for every block. Side: normal to wide and back. */
  toggleFullscreen?(): void;
  /** Spread on the header: vertical drag moves the drawer, horizontal swipe steps (touch only). */
  headerHandlers?: Record<string, unknown>;
  /** Native details text zoom, set by a body pinch or the badge's buttons; absent on web. */
  zoom?: DetailsZoom;
}
export const DetailsShellContext = createContext<DetailsShellValue | null>(null);
