// Retry transient failures (network drops, 429, 5xx) with backoff. Used for Gemini calls.
export async function withRetry<T>(fn: () => Promise<T>, tries = 4, baseMs = 1500): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = String(err);
      const transient = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket|429|RESOURCE_EXHAUSTED|500|502|503|504|UNAVAILABLE|overloaded/i.test(msg);
      if (!transient || i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw last;
}
