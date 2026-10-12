/**
 * Brand marks live on the daemon, not in the client bundle the host sends again
 * on every reconnect. A row asks for its mark by id; the marks a freshly
 * painted timeline needs travel in one request, and a re-evaluated bundle
 * draws the ones it already has without asking again.
 */
import { readdirSync, readFileSync } from "node:fs";
import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MARK_IDS,
  MONO_MARKS,
  readMark,
  setMarkLoader,
  useMarkBitmap,
} from "../../client/components/marks";
import contribute from "../../index.server";
import { MARK_BITMAPS } from "../../server/mark-bitmaps";
import { markBitmapsRpc } from "../../shared/mark-rpc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const globals = globalThis as { __beautifulChatMarkBitmaps?: unknown };

afterEach(() => {
  setMarkLoader(null);
  delete globals.__beautifulChatMarkBitmaps;
});

function Probe({ id, seen }: { id: string; seen: Map<string, string | null | undefined> }) {
  seen.set(id, useMarkBitmap(id));
  return null;
}

async function render(ids: string[]) {
  const seen = new Map<string, string | null | undefined>();
  await act(async () => {
    create(
      React.createElement(
        React.Fragment,
        null,
        ids.map((id) => React.createElement(Probe, { key: id, id, seen })),
      ),
    );
  });
  return seen;
}

const answer = async (ids: string[]) =>
  Object.fromEntries(ids.filter((id) => MARK_BITMAPS[id]).map((id) => [id, MARK_BITMAPS[id]!]));

describe("brand marks", () => {
  it("name exactly the marks the daemon serves", () => {
    expect([...MARK_IDS].sort()).toEqual(Object.keys(MARK_BITMAPS).sort());
    for (const id of MONO_MARKS) expect(MARK_IDS.has(id)).toBe(true);
  });

  it("are read in one request for everything a paint needs", async () => {
    const load = vi.fn(answer);
    setMarkLoader(load);
    const seen = await render(["devicon:typescript", "brand:git", "lobe:claude"]);
    await act(async () => {
      await vi.waitFor(() => expect(seen.get("lobe:claude")).toBe(MARK_BITMAPS["lobe:claude"]));
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]![0].sort()).toEqual(["brand:git", "devicon:typescript", "lobe:claude"]);
    expect(seen.get("brand:git")).toBe(MARK_BITMAPS["brand:git"]);
  });

  it("are pending while on their way and unavailable when the daemon cannot answer", async () => {
    let fail!: (error: Error) => void;
    setMarkLoader(() => new Promise((_, reject) => (fail = reject)));
    const seen = await render(["devicon:rust"]);
    expect(seen.get("devicon:rust")).toBeUndefined();
    await act(async () => {
      fail(new Error("offline"));
      await vi.waitFor(() => expect(seen.get("devicon:rust")).toBeNull());
    });
    expect(readMark("not:a-mark")).toBeNull();
    expect(readMark(undefined)).toBeNull();
  });

  it("are drawn at once after a reconnect re-evaluates the bundle", async () => {
    setMarkLoader(answer);
    const first = await render(["devicon:go"]);
    await act(async () => {
      await vi.waitFor(() => expect(first.get("devicon:go")).toBe(MARK_BITMAPS["devicon:go"]));
    });

    setMarkLoader(null);
    const load = vi.fn(() => new Promise<Record<string, string>>(() => {}));
    setMarkLoader(load);
    const second = await render(["devicon:go"]);
    expect(second.get("devicon:go")).toBe(MARK_BITMAPS["devicon:go"]);
    expect(load).not.toHaveBeenCalled();
  });

  it("are answered by the daemon for known ids only", async () => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    contribute({
      registerSettings() {},
      handle(contract: { name: string }, handler: (input: unknown) => Promise<unknown>) {
        handlers.set(contract.name, handler);
      },
    } as never);
    const handler = handlers.get(markBitmapsRpc.name)!;
    const out = markBitmapsRpc.output.parse(
      await handler(markBitmapsRpc.input.parse({ ids: ["brand:git", "toString", "nope"] })),
    );
    expect(out.bitmaps).toEqual({ "brand:git": MARK_BITMAPS["brand:git"] });
  });

  it("stay out of the client bundle", () => {
    const root = new URL("../../", import.meta.url);
    const files = [
      "index.client.tsx",
      ...readdirSync(new URL("client/", root), { recursive: true, encoding: "utf8" })
        .filter((file) => /\.tsx?$/.test(file))
        .map((file) => `client/${file}`),
    ];
    const importers = files.filter((file) =>
      /from\s+["'][^"']*(mark-bitmaps|font-data)["']/.test(readFileSync(new URL(file, root), "utf8")),
    );
    expect(importers).toEqual([]);
  });
});
