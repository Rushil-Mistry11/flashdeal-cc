// Every call resolves (never throws) so the UI can show failures instead of crashing.
async function request(path, options = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(path, options);
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body, cache: res.headers.get('x-cache'), ms: Math.round(performance.now() - t0) };
  } catch {
    return { status: 0, body: {}, cache: null, ms: Math.round(performance.now() - t0) };
  }
}

const json = (method, data) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export const claimDeal = (userId, dealId) => request('/api/claim', json('POST', { userId, dealId }));
export const getDeals = () => request('/api/deals');
export const getOrders = (userId) => request(`/api/orders?userId=${encodeURIComponent(userId)}`);
export const getHealth = () => request('/api/health');
export const setCatalogFailure = (enabled) => request('/api/admin/catalog-failure', json('POST', { enabled }));
export const resetMetrics = () => request('/api/admin/reset-metrics', json('POST', {}));
export const resetSale = () => request('/api/admin/reset-sale', json('POST', {}));
