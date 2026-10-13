/**
 * One copy path for the whole plugin (plan §3.8 item 1, BC-10).
 *
 * Always the SDK's `copyText`, which works on every platform and rejects when
 * the clipboard is unavailable or denied — unlike the browser clipboard API, which
 * does nothing on native and was reported as success anyway. Every copy
 * confirms with a toast, in the settings page's language; a button's own
 * icon also turns into a check for 1.2 s. A failure is always a toast, and
 * never shows the check.
 */
import { useEffect, useRef, useState } from "react";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import {
  createCopyController,
  type CopyController,
  type CopyOptions,
} from "./copy-controller";
import { getEnhancerPreferences } from "../preferences";
import { copiedToast, toolbarLabel } from "../i18n/toolbar-strings";

export type { CopyFeedback, CopyOptions } from "./copy-controller";

export function useCopy(): {
  copied: boolean;
  copy(text: string, options?: CopyOptions): Promise<boolean>;
  copyWith(write: () => Promise<void>, options?: CopyOptions): Promise<boolean>;
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
      // In the settings page's language, read when the toast is shown.
      toast: {
        show: (message, label) => {
          const language = getEnhancerPreferences().language;
          toastRef.current.show(label ? copiedToast(label, language) : toolbarLabel(message, language));
        },
        error: (message) => toastRef.current.error(toolbarLabel(message, getEnhancerPreferences().language)),
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

  return { copied, copy: controllerRef.current.copy, copyWith: controllerRef.current.copyWith };
}
