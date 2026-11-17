const express = require('express');
const config = require('../config');
const redis = require('../services/redisClient');
const { redisKeys } = require('../services/metricKeys');

const router = express.Router();

// Demo helper: break / repair the catalog service to show the circuit breaker.
router.post('/catalog-failure', async (req, res) => {
  try {
    const r = await fetch(`${config.catalogServiceUrl}/admin/failure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: Boolean(req.body && req.body.enabled) }),
      signal: AbortSignal.timeout(1500),
    });
    res.json(await r.json());
  } catch (err) {
    res.status(502).json({ error: 'catalog-service unreachable', detail: err.message });
  }
});

// Demo helper: restock all deals, restart countdowns, delete all claims, clear caches and counters.
router.post('/reset-sale', async (_req, res) => {
  try {
    const r = await fetch(`${config.catalogServiceUrl}/admin/reset-sale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    });
    const body = await r.json();
    if (!r.ok) return res.status(502).json(body);
    try { await redis.del('cache:deals', 'cache:deals:stale', ...redisKeys); } catch { /* redis down: nothing to clear */ }
    return res.json(body);
  } catch (err) {
    return res.status(502).json({ error: 'catalog-service unreachable', detail: err.message });
  }
});

// Demo helper: zero the counters before a load test.
router.post('/reset-metrics', async (_req, res) => {
  try {
    await redis.del(...redisKeys);
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

module.exports = router;
