import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactTestRenderer } from "react-test-renderer";
import "./helpers/quiet-renderer";

// Event orderings between the host's settings query and the daemon's
// `plugin_settings_changed` pushes, on a real TanStack query configured as the
// host's replica query (`packages/app/src/data/query.ts`) and read through a
// copy of the host's `useSettings` state mapping (`use-settings.ts`).

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: () => null }));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
  useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null),
  usePaseo: () => null,
  useSettings: () => ({ status: "loading" }),
}));

type Record = { status: "ready"; revision: string; values: { targetLanguage: string } };
const LANGUAGES: { [revision: string]: string } = { t1: "en", t2: "ja", t3: "fr" };
const record = (revision: string, targetLanguage = LANGUAGES[revision] ?? "en"): Record => ({
  status: "ready",
  revision,
  values: { targetLanguage },
});

// With fake timers only 0 ms passes: TanStack's batched notifications run,
// timed retries wait for `advance`.
const tick = () =>
  vi.isFakeTimers() ? vi.advanceTimersByTimeAsync(0).then(() => undefined) : new Promise<void>((resolve) => setTimeout(resolve, 0));

async function setup() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetModules();
  const React = await import("react");
  const renderer = await import("react-test-renderer");
  const { QueryClient, QueryClientProvider, useQuery } = await import("@tanstack/react-query");
  const store = await import("../../client/translation/settings-store");
  const slot = await import("../../client/state/preference-sync-slot");
  store.resetTranslationSettingsStoreForTests();

  // The daemon answers reads in the order they were sent. Each read sees the
  // record as it was when the daemon handled it; the answer is held in transit
  // until `deliver` lets the host receive it.
  let current = record("t1");
  const inTransit: (() => void)[] = [];
  const daemonRead = (fail = false) => {
    const seen = current;
    return new Promise<Record>((resolve, reject) => {
      inTransit.push(() => (fail ? reject(new Error("read failed")) : resolve(seen)));
    });
  };
  let failConfirms = 0;
  let failHostReads = 0;
  const hostRead = vi.fn(() => {
    const fail = failHostReads > 0;
    if (fail) failHostReads--;
    return daemonRead(fail);
  });
  const confirmRead = vi.fn(() => {
    const fail = failConfirms > 0;
    if (fail) failConfirms--;
    return daemonRead(fail);
  });

  // The host's replica query: `useReplicaQuery` options and `useSettings` state.
  const client = new QueryClient();
  const key = ["plugin-settings", "timeline-translation"];
  function useHostSettings() {
    const query = useQuery({
      queryKey: key,
      queryFn: hostRead,
      retry: false,
      gcTime: Infinity,
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    });
    const actions = {
      saving: false,
      saveError: null,
      save: vi.fn(),
      reset: vi.fn(),
      reload: async () => {
        await query.refetch();
      },
    };
    if (query.isPending) return { ...actions, status: "loading" as const };
    if (query.isError) return { ...actions, status: "error" as const, error: query.error.message };
    return { ...actions, ...query.data };
  }
  function Report() {
    store.useTranslationSettingsReport(useHostSettings() as never);
    return null;
  }

  // The plugin's watcher, on the same push the host invalidates its query for.
  type Observer = { snapshot(snapshot: unknown): void; update(message: unknown): void };
  const observers = new Set<Observer>();
  const plugin = {
    rpc: vi.fn((contract: { name: string }) => {
      if (contract.name === "settings.timeline-translation.read") return confirmRead();
      return Promise.resolve(null);
    }),
    paseo: {
      observeEvents: () => ({
        // The host sends the subscription's snapshot once it accepts it
        // (`connection/owned.ts`), and again after every reconnect.
        subscribe(observer: Observer) {
          observers.add(observer);
          void Promise.resolve().then(() => observer.snapshot({ subscriptionId: "s1" }));
          return () => observers.delete(observer);
        },
        release: () => Promise.resolve(),
      }),
    },
  };
  const stopWatch = slot.watchPreferenceChanges(plugin as never);

  // Every state the store published since the latest write: none may show a
  // record other than the one that write stored.
  let sinceWrite: { status: string; revision: string | null }[] = [];
  const stopSpy = store.translationSettingsSync.subscribe(() => {
    const { status, revision } = store.getTranslationSettingsState();
    sinceWrite.push({ status, revision });
  });
  const shownSinceWrite = () => sinceWrite.filter((state) => state.status === "ready" || state.status === "invalid");

  /** Another client writes the record; the daemon pushes the change to this client. */
  const write = async (next: Record) => {
    current = next;
    sinceWrite = [];
    await renderer.act(async () => {
      // `catalog-sync-model.ts` subscribes before the plugin's `contribute()`.
      void client.invalidateQueries({ queryKey: key });
      for (const observer of observers) {
        observer.update({
          type: "status",
          payload: { status: "plugin_settings_changed", pluginId: "better-paseo", settingsId: "timeline-translation" },
        });
      }
    });
    // Nothing translates under the old values while the change is read.
    expect(store.getTranslationSettingsState().status).toBe("loading");
  };
  /** Another client writes the record while this one is offline: no push reaches it. */
  const writeOffline = (next: Record) => {
    current = next;
    sinceWrite = [];
  };
  /**
   * The connection comes back: every subscription is requested again and
   * delivers a new snapshot. The host's catalog sync refreshes the catalog
   * first, then invalidates every settings query (`catalog-sync-model.ts`).
   */
  const reconnect = async () => {
    await renderer.act(async () => {
      for (const observer of observers) observer.snapshot({ subscriptionId: "s2" });
      await tick();
      void client.invalidateQueries({ queryKey: ["plugin-settings"], refetchType: "all" });
    });
  };
  /** Moves the fake clock (tests that call `vi.useFakeTimers`). */
  const advance = async (ms: number) => {
    await renderer.act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  /** Delivers every answer in transit, in order, until no read is left. */
  const deliver = async (count = Infinity) => {
    let delivered = 0;
    await renderer.act(async () => {
      for (let round = 0; round < 20; round++) {
        while (inTransit.length > 0 && delivered < count) {
          inTransit.shift()!();
          delivered++;
          await tick();
        }
        await tick();
        if (inTransit.length === 0 || delivered >= count) break;
      }
    });
  };
  const mount = async () => {
    let row!: ReactTestRenderer;
    await renderer.act(async () => {
      row = renderer.create(React.createElement(QueryClientProvider, { client }, React.createElement(Report)));
    });
    return row;
  };
  const unmount = async (row: ReactTestRenderer) => {
    await renderer.act(async () => row.unmount());
  };
  const hostCopy = () => (client.getQueryData(key) as Record | undefined)?.revision;
  const shown = () => store.getTranslationSettingsState();
  const failNextConfirm = (count = 1) => {
    failConfirms += count;
  };
  const stopFailingConfirms = () => {
    failConfirms = 0;
  };
  const failNextHostRead = () => {
    failHostReads++;
  };
  const act = renderer.act;
  /** The store showed only `revision` since the latest write, and shows it now. */
  const settledOn = (revision: string) => {
    expect(shownSinceWrite().map((state) => state.revision)).toEqual(
      shownSinceWrite().map(() => revision),
    );
    expect(shownSinceWrite().length).toBeGreaterThan(0);
    expect(store.getTranslationSettingsState()).toMatchObject({ status: "ready", revision });
  };
  const cleanup = () => {
    stopSpy();
    stopWatch();
    client.clear();
  };
  return { store, client, key, write, deliver, mount, unmount, hostCopy, shown, hostRead, confirmRead, shownSinceWrite, failNextConfirm, stopFailingConfirms, failNextHostRead, writeOffline, reconnect, advance, act, settledOn, cleanup };
}

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
  vi.useRealTimers();
});
async function harness() {
  const h = await setup();
  cleanups.push(h.cleanup);
  return h;
}

describe("translation settings follow the daemon across event orderings", () => {
  it("settles on the latest record when a push arrives during the host's first read", async () => {
    const h = await harness();
    await h.write(record("t2"));
    await h.deliver();
    // The first hook mounts; the host's first read sees t2 and is in transit.
    const row = await h.mount();
    expect(h.hostRead).toHaveBeenCalledTimes(1);
    // t3 lands while that read has no data yet: the host's invalidation joins
    // the first read instead of reading again.
    await h.write(record("t3"));
    expect(h.hostRead).toHaveBeenCalledTimes(1);
    await h.deliver();
    h.settledOn("t3");
    expect(h.shown().values.targetLanguage).toBe("fr");
    expect(h.hostCopy()).toBe("t3");
    await h.unmount(row);
    h.settledOn("t3");
  });

  it("settles on the latest record when a push lands while a reload joins the host's first read", async () => {
    const h = await harness();
    // t1 is written while no settings hook is mounted (no host query yet).
    await h.write(record("t1"));
    // A hook mounts; its first read sees t1. Then t2 lands before it answers.
    const row = await h.mount();
    await h.write(record("t2"));
    await h.deliver();
    h.settledOn("t2");
    expect(h.hostCopy()).toBe("t2");
    await h.unmount(row);
    const again = await h.mount();
    await h.deliver();
    h.settledOn("t2");
    await h.unmount(again);
  });

  it("acknowledges a push that did not change the revision", async () => {
    const h = await harness();
    const row = await h.mount();
    await h.deliver();
    await h.write(record("t1"));
    await h.deliver();
    h.settledOn("t1");
    await h.unmount(row);
    // Nothing is left unconfirmed: a remount shows t1 without reading again.
    const reads = h.hostRead.mock.calls.length + h.confirmRead.mock.calls.length;
    const again = await h.mount();
    await h.deliver();
    h.settledOn("t1");
    expect(h.hostRead.mock.calls.length + h.confirmRead.mock.calls.length).toBe(reads);
    await h.unmount(again);
  });

  it("follows t1 to t2 and back to t1", async () => {
    const h = await harness();
    const row = await h.mount();
    await h.deliver();
    await h.write(record("t2"));
    await h.write(record("t1"));
    await h.deliver();
    h.settledOn("t1");
    expect(h.hostCopy()).toBe("t1");
    await h.unmount(row);
  });

  it("reads a change missed while unmounted before showing the host's cached copy", async () => {
    const h = await harness();
    const row = await h.mount();
    await h.deliver();
    await h.unmount(row);
    await h.write(record("t2"));
    await h.deliver();
    h.settledOn("t2");
    // The host's retained copy is still t1 and it does not read on mount.
    expect(h.hostCopy()).toBe("t1");
    const again = await h.mount();
    await h.deliver();
    h.settledOn("t2");
    expect(h.hostCopy()).toBe("t2");
    await h.unmount(again);
  });

  it("recovers from a failed confirming read once the host reports the change", async () => {
    const h = await harness();
    const row = await h.mount();
    await h.deliver();
    // The host's refetch succeeds; the plugin's own read fails.
    h.failNextConfirm();
    await h.write(record("t2"));
    await h.deliver();
    h.settledOn("t2");
    await h.unmount(row);
    // Nothing is left unconfirmed: the next mount does not read again.
    const reads = h.hostRead.mock.calls.length + h.confirmRead.mock.calls.length;
    const again = await h.mount();
    await h.deliver();
    h.settledOn("t2");
    expect(h.hostRead.mock.calls.length + h.confirmRead.mock.calls.length).toBe(reads);
    await h.unmount(again);
  });

  it("shows the read error, not the old record, when a confirming read fails", async () => {
    const h = await harness();
    const row = await h.mount();
    await h.deliver();
    // Same revision: the host's refetch reports nothing new to retry on.
    h.failNextConfirm();
    await h.write(record("t1"));
    await h.deliver();
    expect(h.shown()).toMatchObject({ status: "error", error: "read failed" });
    await h.unmount(row);
    expect(h.shown().status).toBe("error");
    // The next hook to mount reads it again.
    const again = await h.mount();
    await h.deliver();
    h.settledOn("t1");
    await h.unmount(again);
  });

  it("reads the record again after a reconnect whose host refetch fails", async () => {
    const h = await harness();
    const row = await h.mount();
    await h.deliver();
    // A push confirmed t1, so the store is past a confirmed revision.
    await h.write(record("t1"));
    await h.deliver();
    h.settledOn("t1");
    // Offline, another client changes the record; the host's refetch after
    // the reconnect fails, so its error must not leave t1 showing.
    h.writeOffline(record("t2"));
    h.failNextHostRead();
    await h.reconnect();
    expect(h.shown().status).toBe("loading");
    await h.deliver();
    h.settledOn("t2");
    await h.unmount(row);
  });

  it("does not show the old record after a reconnect while the read fails", async () => {
    vi.useFakeTimers();
    const h = await harness();
    const row = await h.mount();
    await h.deliver();
    h.writeOffline(record("t2"));
    h.failNextHostRead();
    h.failNextConfirm();
    await h.reconnect();
    await h.deliver();
    // The read is retried (here already on the host's failed refetch).
    await h.advance(60_000);
    await h.deliver();
    h.settledOn("t2");
    await h.unmount(row);
  });

  it("retries a failed read after the host already reported the change", async () => {
    vi.useFakeTimers();
    const h = await harness();
    const row = await h.mount();
    await h.deliver();
    // The host's refetch answers t2 first; then the plugin's read fails twice.
    // The host does not report again, and its t2 proves nothing on its own.
    h.failNextConfirm(2);
    await h.write(record("t2"));
    await h.deliver();
    expect(h.shown()).toMatchObject({ status: "error" });
    expect(h.hostCopy()).toBe("t2");
    const reads = h.confirmRead.mock.calls.length;
    await h.advance(60_000);
    await h.deliver();
    expect(h.shown()).toMatchObject({ status: "error" });
    expect(h.confirmRead.mock.calls.length).toBe(reads + 1);
    await h.advance(60_000);
    await h.deliver();
    h.settledOn("t2");
    expect(h.confirmRead.mock.calls.length).toBe(reads + 2);
    await h.unmount(row);
  });

  it("stops retrying a read that keeps failing until the next change or hook", async () => {
    vi.useFakeTimers();
    const h = await harness();
    const row = await h.mount();
    await h.deliver();
    h.failNextConfirm(1000);
    await h.write(record("t2"));
    await h.deliver();
    const first = h.confirmRead.mock.calls.length;
    for (let minute = 0; minute < 30; minute++) {
      await h.advance(60_000);
      await h.deliver();
    }
    const retried = h.confirmRead.mock.calls.length - first;
    expect(retried).toBe(3);
    expect(h.shown()).toMatchObject({ status: "error" });
    expect(h.shownSinceWrite()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    // A new hook reads again, with the same bounded retries.
    await h.unmount(row);
    const again = await h.mount();
    await h.deliver();
    for (let minute = 0; minute < 30; minute++) {
      await h.advance(60_000);
      await h.deliver();
    }
    // The mount's read and its three retries.
    expect(h.confirmRead.mock.calls.length - first).toBe(retried + 4);
    expect(h.shown()).toMatchObject({ status: "error" });
    // Once the daemon answers again, the next trigger recovers.
    h.stopFailingConfirms();
    await h.unmount(again);
    const recovered = await h.mount();
    await h.deliver();
    h.settledOn("t2");
    await h.unmount(recovered);
  });

  it("does not retry a failed read after the plugin unloads", async () => {
    vi.useFakeTimers();
    const h = await harness();
    const row = await h.mount();
    await h.deliver();
    h.failNextConfirm();
    await h.write(record("t2"));
    await h.deliver();
    expect(vi.getTimerCount()).toBe(1);
    await h.unmount(row);
    h.cleanup();
    expect(vi.getTimerCount()).toBe(0);
    const reads = h.confirmRead.mock.calls.length;
    await h.advance(60_000);
    expect(h.confirmRead.mock.calls.length).toBe(reads);
  });
});
