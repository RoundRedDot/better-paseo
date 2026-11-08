import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fsp = vi.hoisted(() => ({
  stat: vi.fn(),
  open: vi.fn(),
}));

// Calls land in the mocks so a test can assert nothing touched the filesystem.
// The default implementations delegate to node:fs, except for strings shaped
// like a share or device path: a guard regression must not reach the network
// even when these tests run on Windows. The shape is deliberately written out
// here instead of importing the guard, so the net cannot regress with it.
vi.mock("node:fs/promises", async (actual) => {
  const real = await actual<typeof FsPromises>();
  const networkLike = /^[\\/]{2}|^[\\/]\?\?[\\/]/;
  type FsCall = (...args: never[]) => unknown;
  const guarded = (call: FsCall): FsCall => (...args) => {
    const target = String(args[0]);
    return networkLike.test(target)
      ? Promise.reject(new Error(`network path reached the filesystem: ${target}`))
      : call(...args);
  };
  fsp.stat.mockImplementation(guarded(real.stat) as never);
  fsp.open.mockImplementation(guarded(real.open) as never);
  return {
    ...real,
    stat: ((...args: Parameters<typeof real.stat>) => fsp.stat(...args)) as typeof real.stat,
    open: ((...args: Parameters<typeof real.open>) => fsp.open(...args)) as typeof real.open,
  };
});

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

type Handler = (input: { cwd: string; path: string }) => Promise<Record<string, unknown>>;

let root = "";
let image: Handler;
let reveal: Handler;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "network-path-"));
  await writeFile(join(root, "shot.png"), Buffer.from(PNG_1PX, "base64"));
  // Imported here so the fs mock above is in place before the server module
  // binds `stat` and `open`; a static import would bind the real ones.
  const { default: contribute } = await import("../../index.server");
  const handlers = new Map<string, Handler>();
  const server = new Proxy({}, {
    get: (_, key) => key === "registerSettings"
      ? () => ({ read: async () => ({ status: "invalid", revision: "test", error: "test" }), subscribe: () => () => {} })
      : key === "handle"
        ? (contract: { name: string }, handler: Handler) => handlers.set(contract.name, handler)
        : () => () => {},
  }) as PluginServerContext;
  contribute(server);
  image = handlers.get("file.image")!;
  reveal = handlers.get("file.reveal")!;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  fsp.stat.mockClear();
  fsp.open.mockClear();
});

const NETWORK_PATHS = [
  "\\\\attacker.example\\share\\shot.png",
  "//attacker.example/share/shot.png",
  "\\\\?\\UNC\\attacker.example\\share\\shot.png",
  "\\\\.\\pipe\\shot.png",
  "  \\\\attacker.example\\share\\shot.png  ",
  "\\??\\UNC\\attacker.example\\share\\shot.png",
  "/??/UNC/attacker.example/share/shot.png",
  "\\??\\C:\\tmp\\shot.png",
  "\\\\attacker.example\\share\\shot.png:12",
  "\\\\.\\UNC\\attacker.example\\share\\shot.png",
  "\\\\?\\GLOBALROOT\\Device\\Mup\\attacker.example\\share\\shot.png",
];

describe("network and device paths (issue #25)", () => {
  it.each(NETWORK_PATHS)("refuses %j before any filesystem access", async (path) => {
    await expect(image({ cwd: root, path })).resolves.toEqual({
      dataUri: null, mime: null, width: null, height: null, bytes: null, error: "Not a local path",
    });
    await expect(reveal({ cwd: root, path })).resolves.toEqual({
      revealed: null, error: "Not a local path",
    });
    expect(fsp.stat).not.toHaveBeenCalled();
    expect(fsp.open).not.toHaveBeenCalled();
  });

  it("refuses a path with no name at all", async () => {
    await expect(image({ cwd: root, path: "   " })).resolves.toMatchObject({ error: "No path" });
    expect(fsp.stat).not.toHaveBeenCalled();
  });

  it("still reads a local image", async () => {
    const result = await image({ cwd: root, path: "shot.png" });
    expect(result.dataUri).toMatch(/^data:image\/png;base64,/);
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(fsp.stat).toHaveBeenCalled();
    expect(fsp.open).toHaveBeenCalled();
  });
});
