import { useEffect, useState } from 'react';
import { getHealth } from '../api.js';

const NAMES = {
  gateway: 'API gateway',
  redis: 'Redis',
  mongodb: 'MongoDB',
  sqs: 'AWS SQS',
  catalogService: 'Catalog service',
};

export default function HealthMonitor() {
  const [health, setHealth] = useState(null);
  const [gatewayDown, setGatewayDown] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const r = await getHealth();
      if (!alive) return;
      if (r.status === 0) setGatewayDown(true);
      else { setGatewayDown(false); setHealth(r.body); }
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const services = health?.services || {};
  const m = health?.metrics || {};
  const statusOf = (key) => (gatewayDown ? 'DOWN' : services[key] || '...');
  const circuit = health?.circuitBreaker?.state;
  const lookups = (m.cacheHits || 0) + (m.cacheMisses || 0);
  const hitRate = lookups ? Math.round((m.cacheHits / lookups) * 100) : null;
  const val = (v) => (v === undefined || v === null ? '-' : v);

  const tiles = [
    ['Queued', val(m.published)],
    ['In queue now', val(m.queueDepth)],
    ['In flight', val(m.queueInFlight)],
    ['Processed', val(m.processed)],
    ['Confirmed', val(m.confirmed)],
    ['Sold out', val(m.soldOut)],
    ['Rejected', val(m.rejected)],
    ['Rate limited', val(m.rateLimited)],
    ['Cache hit rate', hitRate === null ? '-' : `${hitRate}%`],
    ['Claims in database', val(m.persistedInMongo)],
  ];

  return (
    <section className="panel">
      <h2>Infrastructure <span className="sub">refreshes every 3 s</span></h2>

      <ul className="badges">
        {Object.keys(NAMES).map((k) => (
          <li key={k} className={`badge ${statusOf(k).toLowerCase()}`}>
            <span className="dot" />
            <span className="name">{NAMES[k]}</span>
            <span className="state">{statusOf(k)}</span>
          </li>
        ))}
      </ul>

      <div className="circuit">
        Circuit to catalog service: <strong className={`circuit-${(circuit || 'closed').toLowerCase()}`}>{circuit || '...'}</strong>
      </div>

      <dl className="metrics">
        {tiles.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
    </section>
  );
}
