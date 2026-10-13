/**
 * The copy state machine behind `useCopy`, without React or the SDK, so it is
 * tested with fake timers and a fake clipboard.
 */
/** `icon`: a toast and the button's check; `toast`: the toast alone, for entries with no icon. */
export type CopyFeedback = "icon" | "toast";

export const COPIED_MS = 1200;
export const COPIED_MESSAGE = "Copied";
export const COPY_FAILED_MESSAGE = "Couldn't copy";

export interface CopyOptions {
  feedback?: CopyFeedback;
}

export interface CopyControllerDeps {
  copyText(text: string): Promise<void>;
  toast: { show(message: string): void; error(message: string): void };
  onCopiedChange(copied: boolean): void;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface CopyController {
  /** Resolves true when the text reached the clipboard. */
  copy(text: string, options?: CopyOptions): Promise<boolean>;
  /** (Re)arms the controller; called when the owning component mounts. */
  activate(): void;
  /** Stops a pending reset and ignores copies still in flight. */
  dispose(): void;
}

export function createCopyController(deps: CopyControllerDeps): CopyController {
  let timer: unknown = null;
  let disposed = false;

  const clear = (): void => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };

  return {
    async copy(text, options = {}) {
      const feedback = options.feedback ?? "icon";
      try {
        await deps.copyText(text);
      } catch {
        if (disposed) return false;
        clear();
        deps.onCopiedChange(false);
        deps.toast.error(COPY_FAILED_MESSAGE);
        return false;
      }
      if (disposed) return true;
      // Every copy confirms with a toast; a button also turns its icon into a check.
      deps.toast.show(COPIED_MESSAGE);
      if (feedback === "toast") return true;
      // A second copy restarts the 1.2 s rather than stacking timers.
      clear();
      deps.onCopiedChange(true);
      timer = deps.setTimer(() => {
        timer = null;
        if (!disposed) deps.onCopiedChange(false);
      }, COPIED_MS);
      return true;
    },
    activate() {
      disposed = false;
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}
