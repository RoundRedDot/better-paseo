/**
 * One copy path for the whole plugin (plan §3.8 item 1, BC-10).
 *
 * Always the SDK's `copyText`, which works on every platform and rejects when
 * the clipboard is unavailable or denied — unlike the browser clipboard API, which
 * does nothing on native and was reported as success anyway. Feedback is
 * either the button's own icon turning into a check for 1.2 s, or a toast for
 * entries that have no icon (long-press). A failure is always a toast, and
 * never shows the check.
 */
import { useEffect, useRef, useState } from "react";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import {
  createCopyController,
  type CopyController,
  type CopyOptions,
} from "./copy-controller";

export type { CopyFeedback, CopyOptions } from "./copy-controller";

export function useCopy(): {
  copied: boolean;
  copy(text: string, options?: CopyOptions): Promise<boolean>;
} {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  // The toast API object may change identity between renders; the controller
  // lives for the component's lifetime and reads the latest one.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const controllerRef = useRef<CopyController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createCopyController({
      copyText,
      toast: {
        show: (message) => toastRef.current.show(message),
        error: (message) => toastRef.current.error(message),
      },
      onCopiedChange: setCopied,
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
  }

  useEffect(() => {
    // Re-armed on every mount: React's strict mode unmounts and remounts once
    // in development, and a disposed controller would ignore every copy.
    const controller = controllerRef.current;
    controller?.activate();
    return () => controller?.dispose();
  }, []);

  return { copied, copy: controllerRef.current.copy };
}
