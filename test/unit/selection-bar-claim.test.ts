import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ copyText: vi.fn() }));

const { claimSelectionBar } = await import("../../client/components/selection-actions");

// Each bundle a plugin update loads keeps its own module state; the page they
// share is the scope.
describe("one selection bar across plugin bundles", () => {
  it("retires the earlier bundle's bar when a newer one starts", () => {
    const page = {};
    const older = { dispose: vi.fn() };
    const newer = { dispose: vi.fn() };
    claimSelectionBar(older, page);
    claimSelectionBar(newer, page);
    expect(older.dispose).toHaveBeenCalledOnce();
    expect(newer.dispose).not.toHaveBeenCalled();
  });

  it("keeps the newer bar's claim when the retired one releases late", () => {
    const page = {};
    const older = { dispose: vi.fn() };
    const releaseOlder = claimSelectionBar(older, page);
    const newer = { dispose: vi.fn() };
    claimSelectionBar(newer, page);
    releaseOlder();
    const newest = { dispose: vi.fn() };
    claimSelectionBar(newest, page);
    expect(newer.dispose).toHaveBeenCalledOnce();
  });

  it("frees the page once the live bar releases", () => {
    const page = {};
    const only = { dispose: vi.fn() };
    claimSelectionBar(only, page)();
    claimSelectionBar({ dispose: vi.fn() }, page);
    expect(only.dispose).not.toHaveBeenCalled();
  });
});
