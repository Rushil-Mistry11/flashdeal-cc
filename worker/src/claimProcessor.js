// The flash-sale business logic. Kept separate from the SQS plumbing so it can be tested on its own.
//
// Rules, applied by the worker as messages arrive (a Standard SQS queue is at-least-once with best-effort ordering,
// which is safe here: rule 1 makes redelivery harmless and rule 3 makes overselling impossible whatever the order):
//   1. Same claimId twice (message redelivered)  -> ignored (idempotent)
//   2. User already has a CONFIRMED claim        -> REJECTED / ALREADY_CLAIMED
//   3. Reserve one unit with ONE atomic update that only matches if stock > 0 and the sale window is open.
//      MongoDB applies that update to the document one at a time, so two workers can never take the last unit.
//   4. No match -> SOLD_OUT (or REJECTED for unknown / not started / ended deals)
//   5. Save the CONFIRMED claim. A partial unique index (userId, dealId) is the final guard against double claims;
//      if it trips, or the save fails, the reserved unit is given back.
//
// Known limit (good viva point): the reserve and the save are two writes, not one transaction (a standalone MongoDB
// has no multi-document transactions). If a worker dies between them, one unit stays reserved: stock can be
// under-sold after a crash, but it is never over-sold.
const logger = require('./logger');

module.exports = function createProcessor({ Claim, deals, workerId }) {
  const orderNoFor = (claimId) => `FD-${claimId.slice(0, 8).toUpperCase()}`;

  async function nameFor(dealId) {
    const d = await deals.findOne({ dealId }, { projection: { name: 1 } });
    return d ? d.name : undefined;
  }

  function save(claim, attempts, fields) {
    return Claim.create({
      claimId: claim.claimId,
      requestId: claim.requestId,
      userId: claim.userId,
      dealId: claim.dealId,
      attempts: attempts + 1,
      processedBy: workerId,
      createdAt: new Date(claim.createdAt),
      processedAt: new Date(),
      ...fields,
    });
  }

  async function reject(claim, attempts, reason, dealName) {
    await save(claim, attempts, { status: 'REJECTED', reason, dealName: dealName || (await nameFor(claim.dealId)) });
    return { outcome: 'REJECTED', reason };
  }

  async function release(dealId) {
    try {
      await deals.updateOne({ dealId }, { $inc: { stock: 1, sold: -1 } });
    } catch (err) {
      logger.error('stock_release_failed', { stage: 'worker->mongodb', dealId, err: err.message });
    }
  }

  async function processClaim(claim, attempts = 0) {
    if (await Claim.exists({ claimId: claim.claimId })) return { outcome: 'DUPLICATE' };

    if (await Claim.exists({ userId: claim.userId, dealId: claim.dealId, status: 'CONFIRMED' })) {
      return reject(claim, attempts, 'ALREADY_CLAIMED');
    }

    const now = new Date();
    const result = await deals.findOneAndUpdate(
      { dealId: claim.dealId, stock: { $gt: 0 }, startsAt: { $lte: now }, endsAt: { $gt: now } },
      { $inc: { stock: -1, sold: 1 } },
      { returnDocument: 'after' }
    );
    const deal = result && result.value !== undefined ? result.value : result; // driver 5 vs 6 return shapes

    if (!deal) {
      const d = await deals.findOne({ dealId: claim.dealId });
      if (!d) return reject(claim, attempts, 'UNKNOWN_DEAL');
      if (d.startsAt > now) return reject(claim, attempts, 'NOT_STARTED', d.name);
      if (d.endsAt <= now) return reject(claim, attempts, 'DEAL_ENDED', d.name);
      await save(claim, attempts, { status: 'SOLD_OUT', dealName: d.name });
      return { outcome: 'SOLD_OUT' };
    }

    try {
      await save(claim, attempts, {
        status: 'CONFIRMED',
        dealName: deal.name,
        price: deal.salePrice,
        orderNo: orderNoFor(claim.claimId),
      });
      return { outcome: 'CONFIRMED', stockLeft: deal.stock };
    } catch (err) {
      await release(claim.dealId);
      if (err.code === 11000) {
        if (err.keyPattern && err.keyPattern.claimId) return { outcome: 'DUPLICATE' };
        return reject(claim, attempts, 'ALREADY_CLAIMED', deal.name); // lost a race against the same user's other claim
      }
      throw err; // anything else: let the worker retry the message
    }
  }

  return { processClaim };
};
