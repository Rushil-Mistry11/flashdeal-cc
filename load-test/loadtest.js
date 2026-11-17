#!/usr/bin/env node
// Zero-dependency load tester (Node 18+). Fires N requests with C in flight at once.
//   node loadtest.js --target claim --total 500 --concurrency 50
//   node loadtest.js --target deals --total 500 --concurrency 50
//   node loadtest.js --target claim --reset true     (restock all deals and clear claims first)
//   node loadtest.js --base http://localhost:3000        (local compose)
//   node loadtest.js --base http://<ELASTIC-IP>          (AWS: through nginx on port 80)
// For `claim` it also checks the business rules: stock must never go negative and
// units sold must equal confirmed claims ("no overselling").
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), [])
);
const base = args.base || 'http://localhost:3000';
const target = args.target === 'products' ? 'deals' : args.target || 'claim';
const total = Number(args.total || 500);
const concurrency = Number(args.concurrency || 50);
const runId = Math.random().toString(36).slice(2, 7);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const getJson = (p, opts) => fetch(`${base}${p}`, opts).then((r) => r.json()).catch(() => null);

async function getDeals() {
  for (let i = 0; i < 6; i += 1) {
    const res = await fetch(`${base}/api/deals?nocache=1`).catch(() => null);
    if (res && res.ok) return (await res.json()).deals;
    await sleep(600); // rate limited or busy: wait for the bucket to refill
  }
  return null;
}

async function main() {
  if (args.reset === 'true') {
    await fetch(`${base}/api/admin/reset-sale`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    console.log('Sale reset (all deals restocked, claims cleared)');
    await sleep(1500);
  }

  const health = await getJson('/api/health');
  if (!health) { console.error(`Gateway not reachable at ${base}`); process.exit(1); }
  const before = health.metrics;
  const dealsBefore = target === 'claim' ? await getDeals() : null;
  const dealIds = dealsBefore ? dealsBefore.map((d) => d.dealId) : ['deal-001'];
  const stockSum = (ds) => (ds ? ds.reduce((s, d) => s + d.stock, 0) : null);

  console.log(`Target: ${target} | total: ${total} | concurrency: ${concurrency} | ${base}\n`);
  let n = 0;
  const results = [];

  async function once() {
    const i = n++;
    const t0 = performance.now();
    try {
      const res = target === 'claim'
        ? await fetch(`${base}/api/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // a different shopper every time, spread over all deals
            body: JSON.stringify({ userId: `load-${runId}-${i}`, dealId: dealIds[i % dealIds.length] }),
          })
        : await fetch(`${base}/api/deals`);
      await res.arrayBuffer();
      return { status: res.status, ms: performance.now() - t0, cache: res.headers.get('x-cache') };
    } catch {
      return { status: 0, ms: performance.now() - t0, cache: null };
    }
  }

  const start = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (n < total) results.push(await once());
    })
  );
  const secs = (performance.now() - start) / 1000;

  // let the worker drain the queue so we can report end-to-end numbers
  let after = before;
  if (target === 'claim') {
    for (let i = 0; i < 90; i += 1) {
      await sleep(1000);
      const h = await getJson('/api/health');
      if (h) after = h.metrics;
      const queued = after.published - before.published;
      const done = after.processed - before.processed;
      if ((after.queueDepth || 0) === 0 && done >= queued) break;
    }
  } else {
    after = (await getJson('/api/health')).metrics;
  }

  const byStatus = {};
  results.forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const cache = {};
  results.forEach((r) => { if (r.cache) cache[r.cache] = (cache[r.cache] || 0) + 1; });
  const accepted = (byStatus[202] || 0) + (byStatus[200] || 0);

  const report = {
    target, total, concurrency, durationSec: +secs.toFixed(2),
    throughputRps: +(total / secs).toFixed(1),
    statusCounts: byStatus,
    acceptedPct: +((accepted / total) * 100).toFixed(1),
    rateLimitedPct: +(((byStatus[429] || 0) / total) * 100).toFixed(1),
    latencyMs: { min: +lat[0].toFixed(1), p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1), p99: +pct(lat, 99).toFixed(1), max: +lat[lat.length - 1].toFixed(1) },
    cacheResults: cache,
    serverCounters: {
      published: after.published - before.published,
      processedByWorker: after.processed - before.processed,
      confirmed: after.confirmed - before.confirmed,
      soldOut: after.soldOut - before.soldOut,
      rejected: after.rejected - before.rejected,
      rateLimited: after.rateLimited - before.rateLimited,
      cacheHits: after.cacheHits - before.cacheHits,
      cacheMisses: after.cacheMisses - before.cacheMisses,
      queueDepthAtEnd: after.queueDepth,
      claimsInDatabase: after.persistedInMongo,
    },
  };

  if (target === 'claim') {
    const dealsAfter = await getDeals();
    const unitsSold = stockSum(dealsBefore) - stockSum(dealsAfter);
    report.stockCheck = {
      stockBefore: stockSum(dealsBefore),
      stockAfter: stockSum(dealsAfter),
      unitsSold,
      confirmedClaims: report.serverCounters.confirmed,
      anyNegativeStock: dealsAfter ? dealsAfter.some((d) => d.stock < 0) : null,
      noOverselling: dealsAfter ? !dealsAfter.some((d) => d.stock < 0) && unitsSold === report.serverCounters.confirmed : null,
    };
  }

  console.log(JSON.stringify(report, null, 2));
  const dir = path.join(__dirname, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${target}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\nSaved: ${file}`);
}
main();
