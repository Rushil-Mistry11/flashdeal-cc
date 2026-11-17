// Counters kept in Redis (written by the gateway and the worker, shown on the dashboard).
const KEYS = {
  published: 'published',     // claims accepted by the gateway and queued
  processed: 'processed',     // claims the worker finished (any outcome)
  confirmed: 'confirmed',
  soldOut: 'sold_out',
  rejected: 'rejected',
  rateLimited: 'rate_limited',
  cacheHits: 'cache_hits',
  cacheMisses: 'cache_misses',
};

module.exports = { KEYS, redisKeys: Object.values(KEYS).map((k) => `metrics:${k}`) };
