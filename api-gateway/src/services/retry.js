const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry with exponential backoff + jitter: waits ~base, 2*base, 4*base ...
async function retry(fn, { retries = 3, baseMs = 100, factor = 2, onRetry } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries) throw err;
      const delay = baseMs * factor ** attempt + Math.random() * baseMs;
      if (onRetry) onRetry(err, attempt + 1, Math.round(delay));
      await sleep(delay);
      attempt += 1;
    }
  }
}

module.exports = { retry, sleep };
