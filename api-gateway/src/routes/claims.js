const express = require('express');
const { randomUUID } = require('crypto');
const redis = require('../services/redisClient');
const { publish } = require('../services/queuePublisher');
const { retry } = require('../services/retry');
const logger = require('../utils/logger');

const router = express.Router();

// The gateway does NOT decide the outcome (sold out? already claimed?). It validates the request, puts it on the
// queue and answers 202. The worker applies the business rules against MongoDB, in queue order.
router.post('/', async (req, res) => {
  const { userId, dealId } = req.body || {};
  const userOk = typeof userId === 'string' && userId.trim().length >= 1 && userId.length <= 64;
  const dealOk = typeof dealId === 'string' && /^[a-z0-9-]{1,40}$/i.test(dealId);
  if (!userOk || !dealOk) {
    return res.status(400).json({ error: 'userId (1-64 chars) and dealId are required', requestId: req.id });
  }

  const claim = { claimId: randomUUID(), requestId: req.id, userId: userId.trim(), dealId, createdAt: new Date().toISOString() };

  try {
    await retry(() => publish(claim), {
      retries: 3,
      baseMs: 100,
      onRetry: (err, n, delay) =>
        logger.warn('publish_retry', { stage: 'gateway->queue', requestId: req.id, attempt: n, delayMs: delay, err: err.message }),
    });
    redis.incr('metrics:published').catch(() => {});
    logger.info('claim_queued', { stage: 'gateway->queue', requestId: req.id, claimId: claim.claimId, dealId });
    return res.status(202).json({ status: 'queued', claimId: claim.claimId, requestId: req.id });
  } catch (err) {
    logger.error('claim_publish_failed', { stage: 'gateway->queue', requestId: req.id, err: err.message });
    return res.status(503).json({ error: 'Queue unavailable, try again shortly', requestId: req.id });
  }
});

module.exports = router;
