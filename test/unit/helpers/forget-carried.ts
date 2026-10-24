import { beforeEach } from "vitest";

// The board carries its cards, settings and session on the JS global
// (`client/tasks/board/carry.ts`), which outlives a test: every test starts
// without them. The key is spelled out so no test file loads the client graph
// before its own mocks.
beforeEach(() => {
  const holder = globalThis as Record<string, unknown>;
  delete holder.__betterPaseoTasksCarry;
  delete holder.__betterPaseoDeviceTasksV1;
  let stored: string | null = null;
  holder.__betterPaseoDeviceTasksStorageForTests = { read: () => stored, write: (value: string) => { stored = value; } };
});
