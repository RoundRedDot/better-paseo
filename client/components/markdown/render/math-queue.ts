// A long reply can mount dozens of formulas at once. Leave room in the daemon's
// sixteen-request budget for a second client, retries and in-flight theme changes.
const MAX_IN_FLIGHT = 4;
const waiting: Array<() => void> = [];
let active = 0;

export function enqueueRender<T>(signal: AbortSignal, render: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      signal.removeEventListener("abort", cancel);
      active++;
      void Promise.resolve().then(render).then(resolve, reject).finally(() => {
        active--;
        waiting.shift()?.();
      });
    };
    const cancel = () => {
      const index = waiting.indexOf(start);
      if (index >= 0) waiting.splice(index, 1);
      reject(new Error("Formula render canceled"));
    };

    if (signal.aborted) cancel();
    else if (active < MAX_IN_FLIGHT) start();
    else {
      waiting.push(start);
      signal.addEventListener("abort", cancel, { once: true });
    }
  });
}
