const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

module.exports = {
  port: num(process.env.PORT, 3000),
  redisUrl: process.env.REDIS_URL || 'redis://redis:6379',
  mongoUrl: process.env.MONGO_URL || 'mongodb://mongo:27017',
  mongoDb: process.env.MONGO_DB || 'flashdeal',
  catalogServiceUrl: process.env.CATALOG_SERVICE_URL || 'http://catalog-service:4000',
  // AWS SQS (replaces RabbitMQ). Credentials are NOT configured here: on EC2 the SDK picks them up from the
  // instance profile (LabInstanceProfile); on a laptop it reads AWS_ACCESS_KEY_ID / SECRET / SESSION_TOKEN.
  awsRegion: process.env.AWS_REGION || 'us-east-1',
  sqsQueueName: process.env.SQS_QUEUE_NAME || 'flashdeal-claims',
  sqsQueueUrl: process.env.SQS_QUEUE_URL || '',   // optional: skips the name -> URL lookup
  rateLimit: {
    capacity: num(process.env.RATE_LIMIT_CAPACITY, 10),          // max burst
    refillPerSec: num(process.env.RATE_LIMIT_REFILL_PER_SEC, 5), // sustained rate
  },
  cacheTtlSec: num(process.env.CACHE_TTL_SEC, 3),
  breaker: {
    failureThreshold: num(process.env.BREAKER_FAILURES, 3),
    resetTimeoutMs: num(process.env.BREAKER_RESET_MS, 10000),
  },
};
