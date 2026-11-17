import Art from './Art.jsx';
import { money, discountPct, timeLeft } from '../utils.js';

export default function DealCard({ deal, now, claimed, processing, busy, notice, onClaim }) {
  const ended = new Date(deal.endsAt).getTime() <= now;
  const upcoming = new Date(deal.startsAt).getTime() > now;
  const soldOut = deal.stock <= 0;
  const pct = Math.max(0, Math.min(100, Math.round((deal.stock / deal.totalStock) * 100)));
  const low = !soldOut && pct <= 20;

  let label = 'Claim this deal';
  let disabled = false;
  if (claimed) { label = 'Claimed'; disabled = true; }
  else if (processing || busy) { label = 'Confirming...'; disabled = true; }
  else if (ended) { label = 'Sale ended'; disabled = true; }
  else if (upcoming) { label = 'Not started'; disabled = true; }
  else if (soldOut) { label = 'Sold out'; disabled = true; }

  return (
    <li className={`deal ${soldOut || ended ? 'is-off' : ''}`}>
      <div className={`art cat-${deal.category.toLowerCase()}`}>
        <span className="badge-off">-{discountPct(deal.originalPrice, deal.salePrice)}%</span>
        <Art kind={deal.art} />
      </div>

      <div className="deal-body">
        <span className="cat">{deal.category}</span>
        <h3>{deal.name}</h3>
        <p className="desc">{deal.description}</p>

        <div className="prices">
          <span className="price">{money(deal.salePrice)}</span>
          <s className="was">{money(deal.originalPrice)}</s>
        </div>

        <div
          className={`stockbar ${low ? 'low' : ''}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={deal.totalStock}
          aria-valuenow={deal.stock}
          aria-label={`${deal.stock} of ${deal.totalStock} left`}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="stockline">
          <span className={low ? 'low-text' : ''}>{soldOut ? 'Sold out' : `${deal.stock} of ${deal.totalStock} left`}</span>
          <span>{ended ? 'Sale ended' : `Ends in ${timeLeft(deal.endsAt, now)}`}</span>
        </div>

        <button className={claimed ? 'done' : 'primary'} disabled={disabled} onClick={() => onClaim(deal)}>
          {label}
        </button>
        {notice && <p className={`notice ${notice.tone}`}>{notice.text}</p>}
      </div>
    </li>
  );
}
