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
  /**
   * What is copied, as its button names it ("Copy path"): the toast says
   * "Copied path", so two copies side by side are told apart.
   */
  label?: string;
}

export interface CopyControllerDeps {
  copyText(text: string): Promise<void>;
  /** `label` is the copy's `CopyOptions.label`, when it has one. */
  toast: { show(message: string, label?: string): void; error(message: string): void };
  onCopiedChange(copied: boolean): void;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface CopyController {
  /** Resolves true when the text reached the clipboard. */
  copy(text: string, options?: CopyOptions): Promise<boolean>;
  /** The same feedback for any other clipboard write, such as an image. */
  copyWith(write: () => Promise<void>, options?: CopyOptions): Promise<boolean>;
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

  const copyWith = async (write: () => Promise<void>, options: CopyOptions = {}): Promise<boolean> => {
    const feedback = options.feedback ?? "icon";
    try {
      await write();
    } catch {
      if (disposed) return false;
      clear();
      deps.onCopiedChange(false);
      deps.toast.error(COPY_FAILED_MESSAGE);
      return false;
    }
    if (disposed) return true;
    // Every copy confirms with a toast; a button also turns its icon into a check.
    deps.toast.show(COPIED_MESSAGE, options.label);
    if (feedback === "toast") return true;
    // A second copy restarts the 1.2 s rather than stacking timers.
    clear();
    deps.onCopiedChange(true);
    timer = deps.setTimer(() => {
      timer = null;
      if (!disposed) deps.onCopiedChange(false);
    }, COPIED_MS);
    return true;
  };

  return {
    copy: (text, options) => copyWith(() => deps.copyText(text), options),
    copyWith,
    activate() {
      disposed = false;
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}
