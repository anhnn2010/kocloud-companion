/**
 * Create a small FIFO concurrency limiter for remote operations.
 *
 * @param {number} maxConcurrency
 * @returns {{run: <T>(task: () => Promise<T>) => Promise<T>}}
 */
export function createConcurrencyLimiter(maxConcurrency) {
  const limit = Math.max(
    1,
    Math.floor(Number(maxConcurrency) || 1)
  );
  let active = 0;
  const queue = [];

  const drain = () => {
    while (active < limit && queue.length > 0) {
      const next = queue.shift();
      active += 1;

      Promise.resolve()
        .then(next.task)
        .then(next.resolve, next.reject)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  };

  return {
    run(task) {
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        drain();
      });
    },
  };
}
