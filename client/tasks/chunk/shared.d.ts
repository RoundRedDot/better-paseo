/** The modules the Tasks chunk shares with the bundle, by path; made by `scripts/build-client.mjs`. */
declare module "bc-tasks-shared" {
  const shared: Record<string, unknown>;
  export default shared;
}
