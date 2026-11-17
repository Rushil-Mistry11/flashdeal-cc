import { useCallback, useEffect, useState } from 'react';
import { getDeals } from '../api.js';
import { useNow } from '../utils.js';
import DealCard from './DealCard.jsx';

export default function Shop({ orders, pending, onClaim, refreshKey }) {
  const [deals, setDeals] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);
  const [notices, setNotices] = useState({});
  const now = useNow(1000);

  const load = useCallback(async () => {
    const r = await getDeals();
    if (r.status === 200) {
      setDeals(r.body.deals || []);
      setNote(r.cache === 'STALE' ? 'The catalog service is down. Showing the last saved prices and stock.' : '');
    } else if (r.status === 429) {
      setNote('Too many requests. Wait a moment, then refresh.');
    } else {
      setNote('Deals are unavailable right now.');
    }
  }, []);

  // Stock changes while people claim, so refresh regularly and right after one of our claims finishes.
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  const claimedIds = new Set(orders.filter((o) => o.status === 'CONFIRMED').map((o) => o.dealId));
  const processingIds = new Set(pending.map((p) => p.dealId));

  const claim = async (deal) => {
    setBusy(deal.dealId);
    const result = await onClaim(deal);
    setBusy(null);
    setNotices((n) => ({ ...n, [deal.dealId]: result }));
  };

  return (
    <section>
      <div className="banner">
        <strong>Flash sale is live.</strong> Limited stock, one per customer. Claims are confirmed in the order they reach the queue.
      </div>

      {note && <p className="notice warn wide">{note}</p>}

      <ul className="deals">
        {deals === null &&
          [0, 1, 2, 3].map((i) => <li key={i} className="deal skeleton" aria-hidden="true" />)}
        {deals && deals.map((d) => (
          <DealCard
            key={d.dealId}
            deal={d}
            now={now}
            claimed={claimedIds.has(d.dealId)}
            processing={processingIds.has(d.dealId)}
            busy={busy === d.dealId}
            notice={notices[d.dealId]}
            onClaim={claim}
          />
        ))}
      </ul>
    </section>
  );
}
