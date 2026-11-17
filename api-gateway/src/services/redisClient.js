const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

// enableOfflineQueue=false -> commands fail fast when Redis is down instead of hanging,
// which lets the rate limiter "fail open" and the cache degrade gracefully.
const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

let lastErrorLog = 0;
redis.on('error', (err) => {
  if (Date.now() - lastErrorLog > 5000) {
    lastErrorLog = Date.now();
    logger.error('redis_error', { err: err.message });
  }
});
redis.on('ready', () => logger.info('redis_connected'));

// Token bucket, executed atomically inside Redis.
//   KEYS[1] bucket key | ARGV[1] capacity | ARGV[2] refill tokens per second
// Returns {allowed (1/0), tokens remaining}
redis.defineCommand('tokenBucket', {
  numberOfKeys: 1,
  lua: `
    local t = redis.call('TIME')
    local now = t[1] * 1000 + math.floor(t[2] / 1000)
    local capacity = tonumber(ARGV[1])
    local refill = tonumber(ARGV[2])

    local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
    local tokens = tonumber(data[1])
    local ts = tonumber(data[2])
    if tokens == nil then
      tokens = capacity
      ts = now
    end

    tokens = math.min(capacity, tokens + (math.max(0, now - ts) / 1000) * refill)

    local allowed = 0
    if tokens >= 1 then
      tokens = tokens - 1
      allowed = 1
    end

    redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
    redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / refill * 1000) * 2)
    return { allowed, math.floor(tokens) }
  `,
});

module.exports = redis;
