import { afterEach, describe, expect, it, vi } from "vitest";

import { confirmDialog } from "../../client/components/confirm-dialog";

const INPUT = { title: "Stop this task?", message: "\"Port the ring\" will stop its current turn.", confirmLabel: "Stop", cancelLabel: "Cancel", destructive: true };
const world = globalThis as { paseoDesktop?: unknown; confirm?: unknown };

afterEach(() => {
  delete world.paseoDesktop;
  delete world.confirm;
  vi.restoreAllMocks();
});

describe("confirmDialog", () => {
  it("asks through the desktop bridge's native dialog on Electron, as a warning", async () => {
    const ask = vi.fn(async () => true);
    world.paseoDesktop = { dialog: { ask } };
    world.confirm = vi.fn(() => false);
    await expect(confirmDialog(INPUT)).resolves.toBe(true);
    expect(ask).toHaveBeenCalledWith(INPUT.message, { title: "Stop this task?", okLabel: "Stop", cancelLabel: "Cancel", kind: "warning" });
    expect(world.confirm).not.toHaveBeenCalled();
  });

  it("falls back to the browser's confirm on plain web", async () => {
    const confirm = vi.fn(() => false);
    world.confirm = confirm;
    await expect(confirmDialog(INPUT)).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledWith(`Stop this task?\n\n${INPUT.message}`);
  });
});
