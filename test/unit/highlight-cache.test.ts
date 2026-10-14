import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => rpc.call,
}));

import {
  useHighlightedLines,
  type HighlightRequest,
  type HighlightResponse,
} from "../../client/highlight";
import {
  disablePerf,
  enablePerf,
  perfSnapshot,
  resetPerf,
} from "../../client/debug/perf";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function answer(text = "daemon-token", language: string | null = "typescript") {
  return {
    lines: [[{ text, color: "#abcdef" }]],
    language,
    theme: "dark-plus",
  };
}

function tokenText(response: HighlightResponse): string | null {
  return response.lines?.[0]?.[0]?.text ?? null;
}

function HookProbe({
  request,
  onRender,
}: {
  request: HighlightRequest;
  onRender(response: HighlightResponse): void;
}) {
  const response = useHighlightedLines(request);
  onRender(response);
  return null;
}

async function mount(
  requestValue: HighlightRequest,
  onRender: (response: HighlightResponse) => void,
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(HookProbe, { request: requestValue, onRender }),
    );
  });
  return renderer;
}

function request(code: string, fields: Partial<HighlightRequest> = {}): HighlightRequest {
  return {
    code,
    language: "typescript",
    filename: "sample.ts",
    dark: false,
    ...fields,
  };
}

function counter(name: string): number {
  return perfSnapshot().counters[name] ?? 0;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  rpc.call.mockReset();
  rpc.call.mockImplementation(() => Promise.resolve(answer()));
});

afterEach(() => {
  disablePerf();
  resetPerf();
});

describe("useHighlightedLines cache", () => {
  it("reads a completed cache hit during the remount render", async () => {
    const pending = deferred<unknown>();
    rpc.call.mockReturnValueOnce(pending.promise);
    const requestValue = request("cache-hit-unique-source");
    const firstRenders: HighlightResponse[] = [];
    const first = await mount(requestValue, (value) => firstRenders.push(value));

    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(tokenText(firstRenders[0]!)).toBeNull();
    await act(async () => {
      pending.resolve(answer("cached-token"));
    });
    expect(tokenText(firstRenders.at(-1)!)).toBe("cached-token");
    act(() => first.unmount());

    const remountRenders: HighlightResponse[] = [];
    const remount = await mount(requestValue, (value) => remountRenders.push(value));
    expect(tokenText(remountRenders[0]!)).toBe("cached-token");
    expect(rpc.call).toHaveBeenCalledTimes(1);
    act(() => remount.unmount());
  });

  it("deduplicates concurrent mounts and gives both the valid RPC response", async () => {
    const pending = deferred<unknown>();
    rpc.call.mockReturnValueOnce(pending.promise);
    const requestValue = request("concurrent-cache-unique-source");
    const firstRenders: HighlightResponse[] = [];
    const secondRenders: HighlightResponse[] = [];
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(HookProbe, {
            request: requestValue,
            onRender: (value: HighlightResponse) => firstRenders.push(value),
          }),
          React.createElement(HookProbe, {
            request: requestValue,
            onRender: (value: HighlightResponse) => secondRenders.push(value),
          }),
        ),
      );
    });
    expect(rpc.call).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(answer("shared-token"));
    });
    expect(tokenText(firstRenders.at(-1)!)).toBe("shared-token");
    expect(tokenText(secondRenders.at(-1)!)).toBe("shared-token");
    act(() => renderer.unmount());
  });

  it("caches an RPC failure as null and does not retry on remount", async () => {
    rpc.call.mockReturnValueOnce(Promise.reject(new Error("daemon unavailable")));
    const requestValue = request("failed-cache-unique-source");
    const firstRenders: HighlightResponse[] = [];
    const first = await mount(requestValue, (value) => firstRenders.push(value));
    expect(tokenText(firstRenders.at(-1)!)).toBeNull();
    expect(firstRenders.at(-1)!.diffLines).toBeNull();
    expect(rpc.call).toHaveBeenCalledTimes(1);
    act(() => first.unmount());

    const remountRenders: HighlightResponse[] = [];
    const remount = await mount(requestValue, (value) => remountRenders.push(value));
    expect(tokenText(remountRenders[0]!)).toBeNull();
    expect(rpc.call).toHaveBeenCalledTimes(1);
    act(() => remount.unmount());
  });

  it.each(["plaintext", "text", "txt"])(
    "accepts a null language answer for the %s plain hint",
    async (language) => {
      rpc.call.mockResolvedValueOnce(answer("plain-token", null));
      const renders: HighlightResponse[] = [];
      const renderer = await mount(
        request("plain-hint-" + language + "-unique-source", { language }),
        (value) => renders.push(value),
      );
      expect(tokenText(renders.at(-1)!)).toBe("plain-token");
      expect(rpc.call).toHaveBeenCalledTimes(1);
      act(() => renderer.unmount());
    },
  );

  it("rejects a null language answer for a non-plain hint", async () => {
    rpc.call.mockResolvedValueOnce(answer("must-fall-back", null));
    const renders: HighlightResponse[] = [];
    const renderer = await mount(
      request("non-plain-null-language-unique-source", { language: "typescript" }),
      (value) => renders.push(value),
    );
    expect(tokenText(renders.at(-1)!)).toBeNull();
    expect(rpc.call).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it("uses cache only when disabled, both on hit and miss", async () => {
    const requestValue = request("disabled-cache-unique-source");
    const enabledRenders: HighlightResponse[] = [];
    const enabled = await mount(requestValue, (value) => enabledRenders.push(value));
    expect(tokenText(enabledRenders.at(-1)!)).toBe("daemon-token");
    act(() => enabled.unmount());

    const disabledRenders: HighlightResponse[] = [];
    const disabled = await mount(
      { ...requestValue, enabled: false },
      (value) => disabledRenders.push(value),
    );
    expect(tokenText(disabledRenders[0]!)).toBe("daemon-token");
    expect(rpc.call).toHaveBeenCalledTimes(1);
    act(() => disabled.unmount());

    const missingRenders: HighlightResponse[] = [];
    const missing = await mount(
      request("disabled-cache-miss-unique-source", { enabled: false }),
      (value) => missingRenders.push(value),
    );
    expect(tokenText(missingRenders[0]!)).toBeNull();
    expect(rpc.call).toHaveBeenCalledTimes(1);
    act(() => missing.unmount());
  });

  it("keeps empty code out of the cache and RPC path", async () => {
    enablePerf();
    resetPerf();
    const renders: HighlightResponse[] = [];
    const renderer = await mount(request(""), (value) => renders.push(value));
    expect(tokenText(renders[0]!)).toBeNull();
    expect(rpc.call).not.toHaveBeenCalled();
    expect(counter("highlight.cacheKey")).toBe(0);
    act(() => renderer.unmount());
  });

  it("keeps an empty diff body equivalent to an absent diff body", async () => {
    enablePerf();
    resetPerf();
    const initial = request("empty-diff-body-unique-source", { diffBodyCode: "" });
    const renders: HighlightResponse[] = [];
    const renderer = await mount(initial, (value) => renders.push(value));
    expect(counter("highlight.cacheKey")).toBe(1);
    expect(rpc.call).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.update(
        React.createElement(HookProbe, {
          request: { ...initial, diffBodyCode: undefined },
          onRender: (value: HighlightResponse) => renders.push(value),
        }),
      );
    });
    expect(counter("highlight.cacheKey")).toBe(2);
    expect(rpc.call).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it.each([
    ["same-length code", { code: "same-length-code-A" }, { code: "same-length-code-B" }],
    ["theme", { dark: false }, { dark: true }],
    ["language", { language: "typescript" }, { language: "python" }],
    ["filename", { filename: "first.ts" }, { filename: "other.ts" }],
    ["diff body", { diffBodyCode: "old body" }, { diffBodyCode: "new body" }],
    ["diff body present versus absent", { diffBodyCode: "present" }, { diffBodyCode: undefined }],
  ] as const)(
    "misses the prior entry when the %s changes",
    async (_name, initialFields, changedFields) => {
      enablePerf();
      resetPerf();
      const base = request("dimension-test-unique-source-" + _name, {
        diffBodyCode: "initial body",
        ...initialFields,
      });
      const changed = { ...base, ...changedFields };
      const renders: HighlightResponse[] = [];
      const renderer = await mount(base, (value) => renders.push(value));
      expect(counter("highlight.cacheKey")).toBe(1);

      await act(async () => {
        renderer.update(
          React.createElement(HookProbe, {
            request: changed,
            onRender: (value: HighlightResponse) => renders.push(value),
          }),
        );
      });
      expect(rpc.call).toHaveBeenCalledTimes(2);
      expect(counter("highlight.cacheKey")).toBe(2);
      act(() => renderer.unmount());
    },
  );

  it("does not recompute the key for stable props or enabled changes", async () => {
    enablePerf();
    resetPerf();
    const initial = request("stable-key-unique-source");
    const renders: HighlightResponse[] = [];
    const renderer = await mount(initial, (value) => renders.push(value));
    expect(counter("highlight.cacheKey")).toBe(1);

    await act(async () => {
      renderer.update(
        React.createElement(HookProbe, {
          request: { ...initial },
          onRender: (value: HighlightResponse) => renders.push(value),
        }),
      );
    });
    expect(counter("highlight.cacheKey")).toBe(1);

    await act(async () => {
      renderer.update(
        React.createElement(HookProbe, {
          request: { ...initial, enabled: false },
          onRender: (value: HighlightResponse) => renders.push(value),
        }),
      );
    });
    expect(counter("highlight.cacheKey")).toBe(1);
    expect(rpc.call).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it("does not count key computations while perf probes are disabled", async () => {
    disablePerf();
    resetPerf();
    const initial = request("disabled-probe-unique-source");
    const renderer = await mount(initial, () => {});
    await act(async () => {
      renderer.update(
        React.createElement(HookProbe, {
          request: { ...initial, code: "disabled-probe-changed-source" },
          onRender: () => {},
        }),
      );
    });
    expect(counter("highlight.cacheKey")).toBe(0);
    act(() => renderer.unmount());
  });

  it("does not update state when a request resolves after unmount", async () => {
    const pending = deferred<unknown>();
    rpc.call.mockReturnValueOnce(pending.promise);
    const errors: unknown[][] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });
    const renders: HighlightResponse[] = [];
    const renderer = await mount(
      request("unmounted-request-unique-source"),
      (value) => renders.push(value),
    );
    expect(rpc.call).toHaveBeenCalledTimes(1);
    const rendersBeforeUnmount = renders.length;
    act(() => renderer.unmount());

    await act(async () => {
      pending.resolve(answer("late-token"));
    });
    expect(renders).toHaveLength(rendersBeforeUnmount);
    expect(errors.filter((args) => String(args[0]).includes("act("))).toEqual([]);
    consoleError.mockRestore();
  });
});
