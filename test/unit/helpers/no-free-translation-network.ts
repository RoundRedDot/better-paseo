// Free translation calls public services straight from the client. A test
// that reaches one by accident would depend on the network and send text out;
// fail it instead. Tests that exercise the services stub `fetch` themselves.
const FREE_ORIGINS = ["https://edge.microsoft.com", "https://translate-pa.googleapis.com", "https://transmart.qq.com"];
const realFetch = globalThis.fetch;

globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (FREE_ORIGINS.some((origin) => url.startsWith(origin))) {
    return Promise.reject(new Error(`Unit tests must not reach ${url}`));
  }
  return realFetch(input, init);
}) as typeof fetch;
