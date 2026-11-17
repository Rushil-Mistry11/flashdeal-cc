const redis = require('../services/redisClient');
const config = require('../config');
const logger = require('../utils/logger');

const { capacity, refillPerSec } = config.rateLimit;

// Token bucket per client IP. Bucket holds `capacity` tokens, refills at `refillPerSec`.
// Each request costs one token; no token -> 429.
module.exports = async function rateLimiter(req, res, next) {
  try {
    const [allowed, remaining] = await redis.tokenBucket(`ratelimit:${req.ip}`, capacity, refillPerSec);
    res.set('X-RateLimit-Limit', String(capacity));
    res.set('X-RateLimit-Remaining', String(remaining));
    if (allowed === 1) return next();

    redis.incr('metrics:rate_limited').catch(() => {});
    logger.warn('rate_limited', { stage: 'rate-limiter', requestId: req.id, ip: req.ip });
    res.set('Retry-After', String(Math.ceil(1 / refillPerSec)));
    return res.status(429).json({ error: 'Too Many Requests', requestId: req.id });
  } catch (err) {
    // Redis unreachable: fail OPEN so the site stays up (documented trade-off).
    logger.error('rate_limiter_unavailable_fail_open', { requestId: req.id, err: err.message });
    return next();
  }
};
