// Downstream service the gateway calls: owns the product catalogue (MongoDB `deals` collection).
// The gateway protects calls to it with a circuit breaker; /admin/failure lets you break it on demand for the demo.
const express = require('express');
const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongo:27017';
const MONGO_DB = process.env.MONGO_DB || 'flashdeal';
const HOUR = 3600 * 1000;

const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 2000 });
const db = () => client.db(MONGO_DB);
const state = { failing: false };

const log = (msg, f = {}, level = 'info') =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'catalog-service', level, msg, ...f }));

function statusOf(d, now) {
  if (now < d.startsAt) return 'upcoming';
  if (now >= d.endsAt) return 'ended';
  if (d.stock <= 0) return 'sold_out';
  return 'live';
}

const app = express();
app.use(express.json());

app.get('/live', (_req, res) => res.send('ok')); // container healthcheck, always 200

app.get('/health', async (_req, res) => {
  if (state.failing) return res.status(503).json({ status: 'DOWN' });
  try {
    await db().command({ ping: 1 });
    return res.json({ status: 'UP' });
  } catch {
    return res.status(503).json({ status: 'DOWN' });
  }
});

app.get('/deals', async (req, res) => {
  const requestId = req.get('x-request-id');
  if (state.failing) {
    log('deals_failed', { stage: 'catalog-service', requestId, reason: 'simulated failure' }, 'warn');
    return res.status(500).json({ error: 'simulated failure' });
  }
  try {
    const now = new Date();
    const docs = await db().collection('deals').find({}).sort({ dealId: 1 }).project({ _id: 0 }).toArray();
    log('deals_served', { stage: 'catalog-service->mongodb', requestId, count: docs.length });
    return res.json({ deals: docs.map((d) => ({ ...d, status: statusOf(d, now) })), servedAt: now.toISOString() });
  } catch (err) {
    log('deals_db_error', { stage: 'catalog-service->mongodb', requestId, err: err.message }, 'error');
    return res.status(500).json({ error: 'database error' });
  }
});

// ---- demo helpers ----
app.post('/admin/failure', (req, res) => {
  state.failing = Boolean(req.body && req.body.enabled);
  log('failure_mode_changed', { failing: state.failing }, 'warn');
  res.json(state);
});

// Restock every deal, restart the countdowns and delete all claims (clean slate before a demo or load test).
app.post('/admin/reset-sale', async (_req, res) => {
  try {
    const now = Date.now();
    const deals = db().collection('deals');
    const all = await deals.find({}).toArray();
    for (const d of all) {
      await deals.updateOne(
        { _id: d._id },
        { $set: { stock: d.totalStock, sold: 0, startsAt: new Date(now - HOUR), endsAt: new Date(now + d.saleHours * HOUR) } }
      );
    }
    const removed = await db().collection('claims').deleteMany({});
    log('sale_reset', { dealsReset: all.length, claimsDeleted: removed.deletedCount }, 'warn');
    res.json({ ok: true, dealsReset: all.length, claimsDeleted: removed.deletedCount });
  } catch (err) {
    log('sale_reset_failed', { err: err.message }, 'error');
    res.status(500).json({ error: err.message });
  }
});

app.listen(4000, () => log('listening', { port: 4000 }));
