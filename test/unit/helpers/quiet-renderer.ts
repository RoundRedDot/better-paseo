/**
 * react-test-renderer prints a deprecation notice on every `create` (React
 * 19). The renderer is only used to count host views, so that one notice is
 * filtered; every other console error still prints.
 */
const original = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("react-test-renderer is deprecated")) return;
  original(...args);
};
export {};
