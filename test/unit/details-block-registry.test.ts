import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import type { BlockEntry } from "../../client/details/contracts";
import { BLOCK_REGISTRY_LIMIT, getBlock, getBlockList, measureBlockForOrder, registerBlock, useBlock, useBlockList } from "../../client/details/block-registry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function entry(id: string, options: Partial<BlockEntry> = {}): BlockEntry {
  return {
    id,
    agentId: "registry-agent",
    at: 1,
    kind: "tool",
    seq: 0,
    navigable: true,
    hasBody: true,
    mounted: true,
    title: id,
    titleMono: false,
    subtitle: [],
    icon: "file",
    readsImage: false,
    render: () => null,
    copies: () => [],
    ...options,
  };
}

describe("block registry", () => {
  it("keeps the last entry as a tombstone after release", () => {
    const agentId = "registry-tombstone";
    const render = () => "latest";
    const registration = registerBlock(entry("row", { agentId, title: "first" }));
    registration.update(entry("row", { agentId, title: "latest", render }));
    registration.release();

    const tombstone = getBlock(agentId, "row");
    expect(tombstone?.mounted).toBe(false);
    expect(tombstone?.title).toBe("latest");
    expect(tombstone?.render).toBe(render);
    expect(getBlockList(agentId)).toEqual([tombstone]);
  });

  it("keeps a duplicate row mounted until every registration releases it", () => {
    const agentId = "registry-owners";
    const first = registerBlock(entry("same", { agentId }));
    const second = registerBlock(entry("same", { agentId }));
    expect(getBlockList(agentId)).toHaveLength(1);
    first.release();
    expect(getBlock(agentId, "same")?.mounted).toBe(true);
    second.release();
    expect(getBlock(agentId, "same")?.mounted).toBe(false);
  });

  it("uses completed asynchronous measurements to resolve near-time ties", async () => {
    const agentId = "registry-measure";
    const thought = registerBlock(entry("thought", {
      agentId,
      at: 10,
      kind: "thought",
      measure: async () => ({ top: 200, height: 20 }),
    }));
    const tool = registerBlock(entry("tool", {
      agentId,
      at: 11,
      kind: "tool",
      measure: async () => ({ top: 100, height: 20 }),
    }));

    expect(getBlockList(agentId).map((block) => block.id)).toEqual(["thought", "tool"]);
    await measureBlockForOrder(agentId, "thought");
    await measureBlockForOrder(agentId, "tool");
    expect(getBlockList(agentId).map((block) => block.id)).toEqual(["tool", "thought"]);
    thought.release();
    tool.release();
  });

  it("drops the oldest tombstones first at the 500 entry cap", () => {
    const agentId = "registry-limit";
    expect(BLOCK_REGISTRY_LIMIT).toBe(500);
    for (let index = 0; index <= BLOCK_REGISTRY_LIMIT; index++) {
      const registration = registerBlock(entry(`row-${index}`, { agentId, seq: index }));
      registration.release();
    }
    const list = getBlockList(agentId);
    expect(list).toHaveLength(BLOCK_REGISTRY_LIMIT);
    expect(list[0]?.id).toBe("row-1");
    expect(list[list.length - 1]?.id).toBe(`row-${BLOCK_REGISTRY_LIMIT}`);
    expect(getBlock(agentId, "row-0")).toBeNull();
  });

  it("rerenders the list on any entry change and only the selected row on its change", () => {
    const agentId = "registry-selectors";
    const a = registerBlock(entry("a", { agentId }));
    const rowRenders = { a: 0, b: 0 };
    let listRenders = 0;

    function Row({ id }: { id: keyof typeof rowRenders }) {
      const block = useBlock(agentId, id);
      rowRenders[id] = (rowRenders[id] ?? 0) + 1;
      return React.createElement("Row", { title: block?.title });
    }

    function List() {
      const blocks = useBlockList(agentId);
      listRenders += 1;
      return React.createElement("List", { count: blocks.length });
    }

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null,
        React.createElement(List), React.createElement(Row, { id: "a" }), React.createElement(Row, { id: "b" }),
      ));
    });
    const before = { ...rowRenders, listRenders };

    let b!: ReturnType<typeof registerBlock>;
    act(() => { b = registerBlock(entry("b", { agentId })); });
    expect(rowRenders.a).toBe(before.a);
    expect(rowRenders.b).toBe(before.b + 1);
    expect(listRenders).toBe(before.listRenders + 1);

    const afterB = { ...rowRenders, listRenders };
    act(() => { a.update(entry("a", { agentId, title: "updated" })); });
    expect(rowRenders.a).toBe(afterB.a + 1);
    expect(rowRenders.b).toBe(afterB.b);
    expect(listRenders).toBe(afterB.listRenders + 1);

    act(() => { renderer.unmount(); });
    a.release();
    b.release();
  });
});
