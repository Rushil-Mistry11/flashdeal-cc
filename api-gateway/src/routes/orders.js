const express = require('express');
const mongo = require('../services/mongo');
const logger = require('../utils/logger');

const router = express.Router();

// GET /api/orders?userId=alice  -> every claim the worker has finished for this user (confirmed, sold out, rejected).
// Claims still waiting in the queue are not here yet; the UI shows them as "Processing" (eventual consistency).
router.get('/', async (req, res) => {
  const { userId } = req.query;
  if (typeof userId !== 'string' || !userId || userId.length > 64) {
    return res.status(400).json({ error: 'userId query parameter is required (max 64 chars)', requestId: req.id });
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);

  try {
    return res.json({ userId, orders: await mongo.ordersFor(userId, limit) });
  } catch (err) {
    logger.error('orders_failed', { stage: 'gateway->mongodb', requestId: req.id, err: err.message });
    return res.status(503).json({ error: 'Database unavailable', requestId: req.id });
  }
});

module.exports = router;
