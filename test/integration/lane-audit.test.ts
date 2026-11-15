/**
 * Every card's lane against the oracle, on a daemon given by
 * `BP_LANE_AUDIT_HOST` (a private copy of real data: see
 * `test/integration/README.md`). Skipped without it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connect, listAllAgents, listAllWorkspaces, type Connection } from "./helpers/real-daemon";
import { mountBoard, type MountedBoard } from "./helpers/mount-board";
import { compareWithOracle, oracleLanes } from "./helpers/lane-oracle";

vi.mock("react-native", () => import("../unit/helpers/rn-mock"));

const host = process.env.BP_LANE_AUDIT_HOST;
const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!host)("lane audit on a copy of real data", () => {
  let connection: Connection;
  let board: MountedBoard;

  beforeAll(async () => {
    connection = await connect(host!);
    board = await mountBoard(connection.api);
    await board.loadAllDone();
  }, 300_000);

  afterAll(async () => {
    await board?.unmount();
    await connection?.close();
  });

  it("puts every card in the lane the daemon's records call for", async () => {
    const [agents, workspaces] = await Promise.all([
      listAllAgents(connection.api, { includeArchived: true, includeBackground: true }),
      listAllWorkspaces(connection.api),
    ]);
    const expected = oracleLanes(agents, workspaces);
    const shown = board.current.byId;
    const mismatches = compareWithOracle(shown, expected, DAY);
    console.log(`audit: ${expected.size} records, ${shown.size} cards, ${mismatches.length} mismatches`);
    expect(mismatches).toEqual([]);
  }, 120_000);
});
