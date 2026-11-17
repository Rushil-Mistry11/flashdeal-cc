import { useEffect, useState } from 'react';

export const money = (n) => `$${Number.isInteger(n) ? n : Number(n).toFixed(2)}`;
export const discountPct = (original, sale) => Math.round((1 - sale / original) * 100);

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function timeLeft(iso, now) {
  const s = Math.floor((new Date(iso).getTime() - now) / 1000);
  if (s <= 0) return 'Ended';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

export const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : '');

const REASON_LABEL = {
  ALREADY_CLAIMED: 'Already claimed',
  DEAL_ENDED: 'Sale ended',
  NOT_STARTED: 'Not started',
  UNKNOWN_DEAL: 'Unknown deal',
};
const REASON_TEXT = {
  ALREADY_CLAIMED: 'You already claimed this deal. Only one per customer.',
  DEAL_ENDED: 'This sale has ended.',
  NOT_STARTED: 'This sale has not started yet.',
  UNKNOWN_DEAL: 'This deal does not exist.',
};

// One place that turns a saved claim into a label, colour and message.
export function statusInfo(o) {
  const name = o.dealName || o.dealId;
  if (o.status === 'CONFIRMED') return { label: 'Confirmed', tone: 'ok', message: `Order ${o.orderNo} confirmed: ${name}` };
  if (o.status === 'SOLD_OUT') return { label: 'Sold out', tone: 'warn', message: `Sorry, ${name} sold out before your claim was processed.` };
  return { label: REASON_LABEL[o.reason] || 'Rejected', tone: 'blocked', message: REASON_TEXT[o.reason] || 'Your claim was rejected.' };
}
