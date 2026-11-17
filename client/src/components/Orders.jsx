import { clock, money, statusInfo } from '../utils.js';

function Receipt({ o }) {
  const wait = o.processedAt && o.createdAt ? new Date(o.processedAt) - new Date(o.createdAt) : null;
  const rows = [
    ['Order number', o.orderNo],
    ['Deal', o.dealName || o.dealId],
    ['Price paid', o.status === 'CONFIRMED' && o.price != null ? money(o.price) : null],
    ['Claim ID', o.claimId],
    ['Request ID', o.requestId],
    ['Processed by', o.processedBy],
    ['Placed', clock(o.createdAt)],
    ['Finished', clock(o.processedAt)],
    ['Time in queue', wait != null ? `${wait} ms` : null],
    ['Attempts', o.attempts],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');
  return (
    <dl className="receipt">
      {rows.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

export default function Orders({ orders, pending, dbError, userId }) {
  const empty = orders.length === 0 && pending.length === 0;
  return (
    <section className="panel">
      <h2>My orders <span className="sub">for {userId}</span></h2>
      {dbError && <p className="notice error">Could not load your orders from the database.</p>}
      {empty && !dbError && <p className="hint">No orders yet. Claim a deal in the shop and it will show up here.</p>}

      <ul className="orders">
        {pending.map((p) => (
          <li key={p.claimId} className="order">
            <div className="order-row">
              <span className="pill processing">Processing</span>
              <span className="order-name">{p.dealName}</span>
              <code>{p.claimId.slice(0, 8)}</code>
            </div>
          </li>
        ))}
        {orders.map((o) => {
          const info = statusInfo(o);
          return (
            <li key={o.claimId} className="order">
              <details>
                <summary className="order-row">
                  <span className={`pill ${info.tone}`}>{info.label}</span>
                  <span className="order-name">{o.dealName || o.dealId}</span>
                  {o.status === 'CONFIRMED' && <span className="order-price">{money(o.price)}</span>}
                  <time>{clock(o.processedAt)}</time>
                </summary>
                <p className="order-msg">{info.message}</p>
                <Receipt o={o} />
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
