/**
 * Asks yes or no on web the way the host does (`app/src/utils/confirm-dialog.ts`):
 * on Electron the desktop bridge's native dialog (`window.paseoDesktop.dialog.ask`),
 * as Paseo's own archive and delete confirmations; on plain web `window.confirm`,
 * with the title over the message. Native asks with `Alert.alert` itself.
 */
export interface ConfirmDialogInput {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
}

interface DesktopDialog {
  dialog?: {
    ask?: (message: string, options?: { title?: string; okLabel?: string; cancelLabel?: string; kind?: "info" | "warning" | "error" }) => Promise<boolean>;
  };
}

export async function confirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  // The focused control would otherwise take the key that closes the dialog.
  ((globalThis as { document?: Document }).document?.activeElement as HTMLElement | null | undefined)?.blur?.();
  const ask = (globalThis as { paseoDesktop?: DesktopDialog }).paseoDesktop?.dialog?.ask;
  if (typeof ask === "function") {
    return ask(input.message, {
      title: input.title,
      okLabel: input.confirmLabel,
      cancelLabel: input.cancelLabel,
      kind: input.destructive ? "warning" : "info",
    });
  }
  const browserConfirm = (globalThis as { confirm?: (message?: string) => boolean }).confirm;
  return typeof browserConfirm === "function" ? browserConfirm(input.message ? `${input.title}\n\n${input.message}` : input.title) : false;
}
