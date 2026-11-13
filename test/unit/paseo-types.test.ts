import type * as Client from "@getpaseo/client";
import { describe, expectTypeOf, it } from "vitest";
import type * as Derived from "../../server/paseo-types";

// `server/paseo-types.ts` reads these off the plugin SDK so the installed plugin needs no
// `@getpaseo/client`; `npm run typecheck` holds each one to the client package's own type.
describe("server Paseo types", () => {
  it("match @getpaseo/client", () => {
    expectTypeOf<Derived.PaseoApi>().toEqualTypeOf<Client.PaseoApi>();
    expectTypeOf<Derived.PaseoAgentTimelineHandle>().toEqualTypeOf<Client.PaseoAgentTimelineHandle>();
    expectTypeOf<Derived.PaseoAgentTimelineEvent>().toEqualTypeOf<Client.PaseoAgentTimelineEvent>();
    expectTypeOf<Derived.PaseoAgentRefetchResult>().toEqualTypeOf<Client.PaseoAgentRefetchResult>();
    expectTypeOf<Derived.PaseoAgentListOptions>().toEqualTypeOf<Client.PaseoAgentListOptions>();
    expectTypeOf<Derived.PaseoWorkspace>().toEqualTypeOf<Client.PaseoWorkspace>();
    expectTypeOf<Derived.PaseoProviderModelsResult>().toEqualTypeOf<Client.PaseoProviderModelsResult>();
  });
});
