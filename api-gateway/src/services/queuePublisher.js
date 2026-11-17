const { SQSClient, GetQueueUrlCommand, SendMessageCommand, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
const config = require('../config');
const logger = require('../utils/logger');
const { sleep } = require('./retry');

// AWS SQS publisher. Same exported API as the old RabbitMQ version: connectLoop, publish, queueStats, state.
// maxAttempts: 2 keeps the SDK's own retries small; the claims route already wraps publish() in retry().
const sqs = new SQSClient({ region: config.awsRegion, maxAttempts: 2 });

const state = { connected: false };
let queueUrl = null;
let looping = false;

async function resolveQueueUrl() {
  if (config.sqsQueueUrl) return config.sqsQueueUrl;
  const out = await sqs.send(new GetQueueUrlCommand({ QueueName: config.sqsQueueName }), { abortSignal: AbortSignal.timeout(5000) });
  return out.QueueUrl;
}

// Keeps trying (with backoff) until the queue can be found: covers "queue not created yet", missing credentials, no network.
async function connectLoop() {
  if (looping) return;
  looping = true;
  let delay = 500;
  try {
    for (;;) {
      try {
        queueUrl = await resolveQueueUrl();
        state.connected = true;
        logger.info('sqs_connected', { queue: config.sqsQueueName, region: config.awsRegion });
        return;
      } catch (err) {
        logger.warn('sqs_connect_retry', { err: err.message, queue: config.sqsQueueName, delayMs: delay });
        await sleep(delay);
        delay = Math.min(delay * 2, 5000);
      }
    }
  } finally {
    looping = false;
  }
}

// Resolves once SQS has durably stored the message on multiple servers (SendMessage returns only after that).
async function publish(message) {
  if (!state.connected || !queueUrl) throw new Error('queue unavailable');
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        requestId: { DataType: 'String', StringValue: String(message.requestId) },
        claimId: { DataType: 'String', StringValue: String(message.claimId) },
      },
    }),
    { abortSignal: AbortSignal.timeout(3000) }
  );
}

// Queue size for the dashboard / health check. Cached for 2 s because the dashboard polls every 3 s.
// visible = waiting for a worker, inFlight = handed to a worker but not yet deleted. null = SQS unreachable.
let cache = { at: 0, value: null };
async function queueStats() {
  if (!state.connected || !queueUrl) return null;
  if (Date.now() - cache.at < 2000) return cache.value;
  let value = null;
  try {
    const out = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
      }),
      { abortSignal: AbortSignal.timeout(2000) }
    );
    value = {
      visible: Number(out.Attributes.ApproximateNumberOfMessages || 0),
      inFlight: Number(out.Attributes.ApproximateNumberOfMessagesNotVisible || 0),
    };
  } catch (err) {
    logger.warn('sqs_stats_error', { err: err.message });
  }
  cache = { at: Date.now(), value };
  return value;
}

module.exports = { connectLoop, publish, queueStats, state };
