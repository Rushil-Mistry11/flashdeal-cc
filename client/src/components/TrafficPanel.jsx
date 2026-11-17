import { useState } from 'react';
import { claimDeal, getDeals, setCatalogFailure, resetMetrics, resetSale } from '../api.js';

const SPIKE_SIZE = 30;
const LIMITED_DEAL = 'deal-006'; // the 6-unit smartwatch
const rid = () => Math.random().toString(36).slice(2, 8);

function describeClaim(r) {
  const id = (r.body.claimId || '').slice(0, 8);
  if (r.status === 202) return { tone: 'ok', text: `[202 Accepted] claim ${id} queued (${r.ms} ms)` };
  if (r.status === 429) return { tone: 'blocked', text: `[429 Too Many Requests] blocked by rate limiter (${r.ms} ms)` };
  if (r.status === 0) return { tone: 'error', text: `[no response] gateway unreachable (${r.ms} ms)` };
  return { tone: 'error', text: `[${r.status}] ${r.body.error || 'request failed'} (${r.ms} ms)` };
}

function describeDeals(r) {
  if (r.status === 200) {
    const via = { HIT: 'cache hit', MISS: 'fetched from catalog service', STALE: 'catalog service down, served stale cache' }[r.cache] || r.body.source;
    return { tone: r.cache === 'STALE' ? 'warn' : 'info', text: `[200 OK] deals: ${via} (${r.ms} ms)` };
  }
  if (r.status === 429) return { tone: 'blocked', text: '[429 Too Many Requests] deals blocked by rate limiter' };
  return { tone: 'error', text: `[${r.status || 'no response'}] deals: ${r.body.error || 'request failed'}, circuit ${r.body.circuit || 'unknown'}` };
}

export default function TrafficPanel({ addLogs }) {
  const [busy, setBusy] = useState(false);
  const [failing, setFailing] = useState(false);
  const [tally, setTally] = useState({ accepted: 0, blocked: 0, failed: 0 });

  const count = (results) =>
    setTally((t) => ({
      accepted: t.accepted + results.filter((r) => r.status === 202).length,
      blocked: t.blocked + results.filter((r) => r.status === 429).length,
      failed: t.failed + results.filter((r) => r.status !== 202 && r.status !== 429).length,
    }));

  const single = async () => {
    const r = await claimDeal(`demo-${rid()}`, 'deal-001');
    addLogs([describeClaim(r)]);
    count([r]);
  };

  const spike = async () => {
    setBusy(true);
    addLogs([{ tone: 'note', text: `Spike: ${SPIKE_SIZE} different shoppers claim the limited smartwatch at once` }]);
    const results = await Promise.all(Array.from({ length: SPIKE_SIZE }, () => claimDeal(`shopper-${rid()}`, LIMITED_DEAL)));
    addLogs(results.map(describeClaim));
    count(results);
    setBusy(false);
  };

  const loadDeals = async () => addLogs([describeDeals(await getDeals())]);

  const toggleFailure = async () => {
    const r = await setCatalogFailure(!failing);
    if (r.status === 200) {
      setFailing(!failing);
      addLogs([{ tone: 'note', text: !failing ? 'Catalog service is now failing on purpose' : 'Catalog service repaired' }]);
    } else {
      addLogs([{ tone: 'error', text: 'Could not reach the catalog service admin endpoint' }]);
    }
  };

  const reset = async () => {
    await resetMetrics();
    setTally({ accepted: 0, blocked: 0, failed: 0 });
    addLogs([{ tone: 'note', text: 'Counters reset' }]);
  };

  const restock = async () => {
    const r = await resetSale();
    if (r.status === 200) {
      setTally({ accepted: 0, blocked: 0, failed: 0 });
      addLogs([{ tone: 'note', text: `Sale reset: ${r.body.dealsReset} deals restocked, ${r.body.claimsDeleted} claims deleted` }]);
    } else {
      addLogs([{ tone: 'error', text: 'Could not reset the sale' }]);
    }
  };

  return (
    <section className="panel">
      <h2>Traffic</h2>
      <div className="actions">
        <button onClick={single} disabled={busy}>Send one claim</button>
        <button className="primary" onClick={spike} disabled={busy}>Send spike of {SPIKE_SIZE}</button>
      </div>
      <p className="hint">
        The spike targets the smartwatch (6 units). The rate limiter lets about 10 requests through; the worker then confirms 6 and marks the rest sold out. Stock never goes below zero.
      </p>

      <div className="tally" aria-live="polite">
        <div className="ok"><strong>{tally.accepted}</strong> accepted</div>
        <div className="blocked"><strong>{tally.blocked}</strong> blocked</div>
        <div className="error"><strong>{tally.failed}</strong> failed</div>
      </div>

      <h2>Fault tolerance</h2>
      <div className="actions">
        <button onClick={loadDeals}>Load deals</button>
        <button className={failing ? 'danger on' : 'danger'} onClick={toggleFailure}>
          {failing ? 'Repair catalog service' : 'Break catalog service'}
        </button>
      </div>
      <p className="hint">
        Break the catalog service, wait 4 seconds for the cache to expire, then load deals repeatedly. After 3 failures the circuit opens and stale cache is served.
      </p>

      <h2>Demo data</h2>
      <div className="actions">
        <button className="quiet" onClick={reset}>Reset counters</button>
        <button className="quiet" onClick={restock}>Reset sale (restock + clear orders)</button>
      </div>
    </section>
  );
}
