const express = require('express');
const config = require('../config');
const redis = require('../services/redisClient');
const mongo = require('../services/mongo');
const { KEYS, redisKeys } = require('../services/metricKeys');
const { queueStats } = require('../services/queuePublisher');
const { breaker } = require('./deals');

const router = express.Router();
const started = Date.now();

const check = async (fn) => {
  try { return (await fn()) ? 'UP' : 'DOWN'; } catch { return 'DOWN'; }
};

router.get('/', async (_req, res) => {
  const [redisStatus, mongoStatus, catalogStatus] = await Promise.all([
    check(async () => (await redis.ping()) === 'PONG'),
    check(async () => { await mongo.ping(); return true; }),
    check(async () => (await fetch(`${config.catalogServiceUrl}/health`, { signal: AbortSignal.timeout(1000) })).ok),
  ]);
  const queue = await queueStats();           // SQS: waiting + in-flight message counts (null = unreachable)
  const sqsStatus = queue ? 'UP' : 'DOWN';

  let values = [];
  try { values = await redis.mget(...redisKeys); } catch { /* redis down: counters unavailable */ }
  const metrics = {};
  Object.keys(KEYS).forEach((name, i) => { metrics[name] = Number((values && values[i]) || 0); });
  metrics.queueDepth = queue ? queue.visible : null;
  metrics.queueInFlight = queue ? queue.inFlight : null;
  metrics.persistedInMongo = null;
  if (mongoStatus === 'UP') { try { metrics.persistedInMongo = await mongo.countClaims(); } catch { /* ignore */ } }

  const coreUp = [redisStatus, mongoStatus, sqsStatus].every((s) => s === 'UP');
  const allUp = coreUp && catalogStatus === 'UP';

  res.status(coreUp ? 200 : 503).json({
    status: allUp ? 'UP' : coreUp ? 'DEGRADED' : 'DOWN',
    timestamp: new Date().toISOString(),
    uptimeSec: Math.round((Date.now() - started) / 1000),
    services: { gateway: 'UP', redis: redisStatus, mongodb: mongoStatus, sqs: sqsStatus, catalogService: catalogStatus },
    circuitBreaker: breaker.snapshot(),
    metrics,
  });
});

module.exports = router;
