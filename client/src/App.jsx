import { useCallback, useEffect, useRef, useState } from 'react';
import { claimDeal, getOrders } from './api.js';
import { statusInfo } from './utils.js';
import Shop from './components/Shop.jsx';
import Orders from './components/Orders.jsx';
import TrafficPanel from './components/TrafficPanel.jsx';
import HealthMonitor from './components/HealthMonitor.jsx';
import LogFeed from './components/LogFeed.jsx';
import Toasts from './components/Toasts.jsx';

const LS_KEY = 'flashdeal.userId';
const readName = () => { try { return localStorage.getItem(LS_KEY) || 'student-1'; } catch { return 'student-1'; } };
const saveName = (v) => { try { localStorage.setItem(LS_KEY, v); } catch { /* private mode */ } };

const MAX_LOG = 300;
let nextLogId = 1;
let nextToastId = 1;

export default function App() {
  const [tab, setTab] = useState('shop');
  const [userId, setUserId] = useState(readName);
  const [nameDraft, setNameDraft] = useState(readName);
  const [orders, setOrders] = useState([]);
  const [pending, setPending] = useState([]);
  const [dbError, setDbError] = useState(false);
  const [dealsKey, setDealsKey] = useState(0);
  const [logs, setLogs] = useState([]);
  const [toasts, setToasts] = useState([]);
  const pendingRef = useRef([]);
  pendingRef.current = pending;

  const addLogs = useCallback((entries) => {
    const stamped = entries.map((e) => ({ id: nextLogId++, time: new Date().toLocaleTimeString([], { hour12: false }), ...e }));
    setLogs((prev) => [...stamped.reverse(), ...prev].slice(0, MAX_LOG));
  }, []);

  const pushToast = useCallback((tone, text) => {
    const id = nextToastId++;
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  // Poll MongoDB (through the gateway). When a claim we sent shows up, tell the user how it ended.
  const refreshOrders = useCallback(async () => {
    const r = await getOrders(userId);
    if (r.status !== 200) { setDbError(true); return; }
    setDbError(false);
    const list = r.body.orders || [];
    setOrders(list);
    const byId = new Map(list.map((o) => [o.claimId, o]));
    const finished = pendingRef.current.filter((p) => byId.has(p.claimId));
    if (finished.length) {
      setPending((prev) => prev.filter((p) => !byId.has(p.claimId)));
      finished.forEach((p) => {
        const info = statusInfo(byId.get(p.claimId));
        pushToast(info.tone, info.message);
      });
      setDealsKey((k) => k + 1);
    }
  }, [userId, pushToast]);

  useEffect(() => {
    refreshOrders();
    const t = setInterval(refreshOrders, 2000);
    return () => clearInterval(t);
  }, [refreshOrders]);

  const onClaim = useCallback(async (deal) => {
    const r = await claimDeal(userId, deal.dealId);
    if (r.status === 202) {
      setPending((p) => [{ claimId: r.body.claimId, dealId: deal.dealId, dealName: deal.name }, ...p]);
      addLogs([{ tone: 'ok', text: `[202 Accepted] shop claim for ${deal.dealId} queued (${r.ms} ms)` }]);
      return { tone: 'ok', text: 'Request received. Confirming your claim...' };
    }
    if (r.status === 429) {
      addLogs([{ tone: 'blocked', text: `[429 Too Many Requests] shop claim for ${deal.dealId} blocked by rate limiter` }]);
      return { tone: 'blocked', text: 'Too many requests. Wait a second and try again.' };
    }
    addLogs([{ tone: 'error', text: `[${r.status || 'no response'}] shop claim for ${deal.dealId} failed` }]);
    return { tone: 'error', text: 'Something went wrong. Please try again.' };
  }, [userId, addLogs]);

  const commitName = () => {
    const v = nameDraft.trim().slice(0, 64);
    if (!v) { setNameDraft(userId); return; }
    if (v !== userId) { setUserId(v); setOrders([]); setPending([]); saveName(v); }
    setNameDraft(v);
  };

  const tabs = [
    ['shop', 'Shop'],
    ['orders', 'My orders'],
    ['control', 'Control room'],
  ];

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>
            <span>FlashDeal</span>
          </div>
          <label className="who">
            <span>Shopping as</span>
            <input
              value={nameDraft}
              maxLength={64}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>
        </div>
      </header>

      <main className="shell">
        <nav className="tabs" role="tablist">
          {tabs.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'tab on' : 'tab'} onClick={() => setTab(key)}>
              {label}
              {key === 'orders' && pending.length > 0 && <span className="count">{pending.length}</span>}
            </button>
          ))}
        </nav>

        {tab === 'shop' && <Shop orders={orders} pending={pending} onClaim={onClaim} refreshKey={dealsKey} />}
        {tab === 'orders' && <Orders orders={orders} pending={pending} dbError={dbError} userId={userId} />}
        {tab === 'control' && (
          <>
            <div className="grid">
              <TrafficPanel addLogs={addLogs} />
              <HealthMonitor />
            </div>
            <LogFeed logs={logs} onClear={() => setLogs([])} />
          </>
        )}
      </main>

      <Toasts toasts={toasts} />
    </>
  );
}
