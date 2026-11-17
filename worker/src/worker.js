const fs = require('fs');
const { SQSClient, GetQueueUrlCommand } = require('@aws-sdk/client-sqs');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const Claim = require('./models/Claim');
const createProcessor = require('./claimProcessor');
const createConsumer = require('./sqsConsumer');
const logger = require('./logger');

const cfg = {
  mongoUrl: process.env.MONGO_URL || 'mongodb://mongo:27017',
  mongoDb: process.env.MONGO_DB || 'flashdeal',
  redisUrl: process.env.REDIS_URL || 'redis://redis:6379',
  region: process.env.AWS_REGION || 'us-east-1',
  queueName: process.env.SQS_QUEUE_NAME || 'flashdeal-claims',
  queueUrl: process.env.SQS_QUEUE_URL || '',
  concurrency: Number(process.env.WORKER_PREFETCH || 5), // claims handled at once by this worker
  minMs: Number(process.env.PROCESSING_MS_MIN || 150),
  maxMs: Number(process.env.PROCESSING_MS_MAX || 400),
  failRate: Number(process.env.FAIL_RATE || 0),
  maxAttempts: Number(process.env.MAX_ATTEMPTS || 3), // keep equal to maxReceiveCount of the queue's redrive policy
};
const WORKER_ID = process.env.HOSTNAME || `worker-${process.pid}`;
const HEARTBEAT_FILE = '/tmp/heartbeat'; // read by the docker healthcheck
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry a connection with exponential backoff until it works.
async function withBackoff(name, fn) {
  let delay = 500;
  for (;;) {
    try {
      const result = await fn();
      logger.info(`${name}_connected`);
      return result;
    } catch (err) {
      logger.warn(`${name}_connect_retry`, { err: err.message, delayMs: delay });
      await sleep(delay);
      delay = Math.min(delay * 2, 5000);
    }
  }
}

async function main() {
  mongoose.set('bufferTimeoutMS', 3000);
  await withBackoff('mongodb', () =>
    mongoose.connect(cfg.mongoUrl, { dbName: cfg.mongoDb, serverSelectionTimeoutMS: 3000 })
  );
  const { processClaim } = createProcessor({
    Claim,
    deals: mongoose.connection.collection('deals'),
    workerId: WORKER_ID,
  });

  const redis = new Redis(cfg.redisUrl);
  redis.on('error', (e) => logger.error('redis_error', { err: e.message }));
  const count = (name) => redis.incr(`metrics:${name}`).catch(() => {});

  const sqs = new SQSClient({ region: cfg.region });
  const queueUrl = await withBackoff('sqs', async () => {
    if (cfg.queueUrl) return cfg.queueUrl;
    const out = await sqs.send(new GetQueueUrlCommand({ QueueName: cfg.queueName }), { abortSignal: AbortSignal.timeout(5000) });
    return out.QueueUrl;
  });

  async function onMessage({ body, receiveCount }) {
    let claim;
    try {
      claim = JSON.parse(body);
    } catch {
      logger.error('bad_message', { stage: 'queue->worker', receiveCount });
      const e = new Error('unparseable message');
      e.permanent = true; // retrying cannot fix it: let SQS move it to the DLQ quickly
      throw e;
    }

    const ctx = { stage: 'queue->worker', requestId: claim.requestId, claimId: claim.claimId, dealId: claim.dealId, worker: WORKER_ID, attempt: receiveCount };
    logger.info('claim_received', ctx);

    try {
      await sleep(cfg.minMs + Math.random() * (cfg.maxMs - cfg.minMs)); // simulated payment / validation latency
      if (cfg.failRate > 0 && Math.random() < cfg.failRate) throw new Error('simulated processing failure');

      const result = await processClaim(claim, receiveCount - 1);
      logger.info(`claim_${result.outcome.toLowerCase()}`, { ...ctx, stage: 'worker->mongodb', reason: result.reason, stockLeft: result.stockLeft });

      count('processed');
      if (result.outcome === 'CONFIRMED') count('confirmed');
      else if (result.outcome === 'SOLD_OUT') count('sold_out');
      else if (result.outcome === 'REJECTED') count('rejected');
      // returning normally -> the consumer deletes the message from SQS
    } catch (err) {
      if (receiveCount >= cfg.maxAttempts) {
        logger.error('claim_failed_moving_to_dlq', { ...ctx, err: err.message }); // SQS redrive policy moves it
      } else {
        logger.warn('claim_retry_scheduled', { ...ctx, err: err.message, retryInSec: Math.min(2 ** receiveCount, 30) });
      }
      throw err; // not deleted -> redelivered after the backoff, or sent to the DLQ
    }
  }

  let lastBeat = Date.now();
  const writeBeat = () => { try { fs.writeFileSync(HEARTBEAT_FILE, String(Date.now())); } catch { /* ignore */ } };
  writeBeat();
  // Heartbeat is only refreshed while the polling loops are alive; the container healthcheck reads its age.
  const beatTimer = setInterval(() => { if (Date.now() - lastBeat < 45000) writeBeat(); }, 10000);

  const consumer = createConsumer({
    sqs,
    queueUrl,
    concurrency: cfg.concurrency,
    maxAttempts: cfg.maxAttempts,
    onMessage,
    onBeat: () => { lastBeat = Date.now(); },
  });
  logger.info('worker_ready', { worker: WORKER_ID, concurrency: cfg.concurrency, queue: cfg.queueName, region: cfg.region });

  const shutdown = async () => {
    logger.info('worker_shutting_down');
    clearInterval(beatTimer);
    try { await consumer.stop(); await mongoose.disconnect(); redis.disconnect(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error('worker_fatal', { err: err.message });
  process.exit(1);
});
