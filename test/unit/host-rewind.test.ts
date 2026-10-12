/**
 * The prompt's rewind menu comes from the host (Paseo with RewindMenu); on a
 * stock 0.11.2 host the module has no such export and nothing is drawn.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

afterEach(() => {
  vi.doUnmock("react-native");
  vi.doUnmock("@getpaseo/plugin/client/react-native");
});

async function load(withMenu: boolean) {
  vi.resetModules();
  const RewindMenu = vi.fn(() => null);
  vi.doMock("react-native", () => import("./helpers/rn-mock"));
  vi.doMock("@getpaseo/plugin/client/react-native", () =>
    withMenu ? { Icon: () => null, RewindMenu } : { Icon: () => null },
  );
  const module = await import("../../client/ui/host-rewind");
  return { module, RewindMenu };
}

describe("host rewind menu", () => {
  it("is absent on a host without RewindMenu", async () => {
    const { module } = await load(false);
    expect(module.HOST_REWIND_MENU).toBeNull();
  });

  it("is the host's component where the host provides it", async () => {
    const { module, RewindMenu } = await load(true);
    expect(module.HOST_REWIND_MENU).toBe(RewindMenu);
  });

  it("refuses anything that is not a component", async () => {
    const { module } = await load(false);
    expect(module.resolveRewindMenu({ RewindMenu: 1 })).toBeNull();
    expect(module.resolveRewindMenu(null)).toBeNull();
    expect(module.resolveRewindMenu(undefined)).toBeNull();
    const component = () => null;
    expect(module.resolveRewindMenu({ RewindMenu: component })).toBe(component);
  });
});
