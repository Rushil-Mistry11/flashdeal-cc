const express = require('express');
const config = require('../config');
const redis = require('../services/redisClient');
const CircuitBreaker = require('../services/circuitBreaker');
const { retry } = require('../services/retry');
const logger = require('../utils/logger');

const router = express.Router();
const breaker = new CircuitBreaker({ name: 'catalog-service', ...config.breaker });

async function callCatalog(requestId) {
  const r = await fetch(`${config.catalogServiceUrl}/deals`, {
    headers: { 'x-request-id': requestId },
    signal: AbortSignal.timeout(1500),
  });
  if (!r.ok) throw new Error(`catalog-service responded ${r.status}`);
  return r.json();
}

const safeGet = async (key) => {
  try { return await redis.get(key); } catch { return null; }
};

// Flow: Redis cache -> (circuit breaker -> retry with backoff -> catalog-service) -> stale cache fallback
router.get('/', async (req, res) => {
  const bypass = req.query.nocache === '1';

  if (!bypass) {
    const cached = await safeGet('cache:deals');
    if (cached) {
      redis.incr('metrics:cache_hits').catch(() => {});
      logger.info('cache_hit', { stage: 'gateway<->cache', requestId: req.id });
      res.set('X-Cache', 'HIT');
      return res.json({ source: 'cache', ...JSON.parse(cached) });
    }
    redis.incr('metrics:cache_misses').catch(() => {});
  }

  try {
    const data = await breaker.exec(() =>
      retry(() => callCatalog(req.id), {
        retries: 2,
        baseMs: 100,
        onRetry: (err, n, delay) =>
          logger.warn('downstream_retry', { stage: 'gateway->catalog-service', requestId: req.id, attempt: n, delayMs: delay, err: err.message }),
      })
    );
    const payload = JSON.stringify(data);
    redis.set('cache:deals', payload, 'EX', config.cacheTtlSec).catch(() => {});
    redis.set('cache:deals:stale', payload).catch(() => {});
    res.set('X-Cache', 'MISS');
    return res.json({ source: 'catalog-service', ...data });
  } catch (err) {
    logger.error('downstream_failed', { stage: 'gateway->catalog-service', requestId: req.id, err: err.message, circuit: breaker.state });
    const stale = await safeGet('cache:deals:stale');
    if (stale) {
      res.set('X-Cache', 'STALE');
      return res.json({ source: 'stale-cache', ...JSON.parse(stale) });
    }
    return res.status(503).json({ error: 'Catalog service unavailable', circuit: breaker.state, requestId: req.id });
  }
});

module.exports = { router, breaker };
