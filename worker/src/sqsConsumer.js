const { ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand } = require('@aws-sdk/client-sqs');
const logger = require('./logger');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// SQS consumer: `concurrency` independent long-polling loops, each handling one message at a time.
//
//   onMessage({ body, messageId, receiveCount })  resolves  -> message is DELETED (SQS has no ack: delete = ack)
//                                                  rejects   -> message is NOT deleted; its visibility timeout is
//                                                               shortened to a backoff delay, so SQS redelivers it.
//
// After `maxReceiveCount` failed deliveries (set on the queue's redrive policy, 3) SQS moves the message to the
// dead-letter queue by itself, so no DLQ code is needed here.
function createConsumer({ sqs, queueUrl, concurrency, maxAttempts, onMessage, onBeat = () => {} }) {
  let running = true;
  const abort = new AbortController();

  async function settle(m, receiveCount, err) {
    if (!err) {
      try {
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }));
      } catch (e) {
        // Not fatal: the message reappears after the visibility timeout and the worker ignores it as a duplicate.
        logger.error('sqs_delete_failed', { messageId: m.MessageId, err: e.message });
      }
      return;
    }
    // Exponential backoff via visibility timeout: 2 s, 4 s ... (1 s on the last attempt so the DLQ move is prompt).
    const delaySec = err.permanent || receiveCount >= maxAttempts ? 1 : Math.min(2 ** receiveCount, 30);
    try {
      await sqs.send(
        new ChangeMessageVisibilityCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle, VisibilityTimeout: delaySec })
      );
    } catch (e) {
      logger.warn('sqs_visibility_change_failed', { messageId: m.MessageId, err: e.message });
    }
  }

  async function loop(id) {
    let errDelay = 1000;
    while (running) {
      let messages = [];
      try {
        const out = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: 20, // long polling: waits up to 20 s for a message instead of hammering the API
            MessageSystemAttributeNames: ['ApproximateReceiveCount'],
          }),
          { abortSignal: abort.signal }
        );
        messages = out.Messages || [];
        errDelay = 1000;
        onBeat();
      } catch (err) {
        if (!running) break;
        logger.warn('sqs_receive_error', { loop: id, err: err.message, delayMs: errDelay });
        await sleep(errDelay);
        errDelay = Math.min(errDelay * 2, 15000);
        continue;
      }

      for (const m of messages) {
        const receiveCount = Number((m.Attributes && m.Attributes.ApproximateReceiveCount) || 1);
        let failure = null;
        try {
          await onMessage({ body: m.Body, messageId: m.MessageId, receiveCount });
        } catch (err) {
          failure = err;
        }
        await settle(m, receiveCount, failure);
      }
    }
  }

  const loops = Array.from({ length: concurrency }, (_, i) => loop(i + 1));

  return {
    // Stop polling, abort the long poll that is waiting, let in-flight claims finish.
    async stop() {
      running = false;
      abort.abort();
      await Promise.allSettled(loops);
    },
  };
}

module.exports = createConsumer;
