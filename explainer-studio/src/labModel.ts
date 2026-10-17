// Pure computation of what the join demo shows. No imports so Node scripts can run it too.
export type LabOrder = {id: number; amount: number};
export type LabHistory = {id: number; orderId: number; status: string; at: string};
export type JoinedRow = {key: string; orderId: number; amount: number; historyId: number; status: string};

export const formatMoney = (n: number, currency = '₹'): string => {
  const s = Math.abs(Math.round(n)).toString();
  // Indian digit grouping: last three digits, then pairs.
  const grouped = s.length > 3 ? s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3) : s;
  return `${n < 0 ? '-' : ''}${currency}${grouped}`;
};

/** Latest history row per order: greatest `at`, ties broken by greatest `id`. */
export const latestPerOrder = (history: LabHistory[]): Map<number, LabHistory> => {
  const best = new Map<number, LabHistory>();
  for (const h of history) {
    const cur = best.get(h.orderId);
    if (!cur || h.at > cur.at || (h.at === cur.at && h.id > cur.id)) best.set(h.orderId, h);
  }
  return best;
};

export const computeLab = (orders: LabOrder[], history: LabHistory[]) => {
  const byOrder = new Map(orders.map((o) => [o.id, o]));
  // Every (order, history row) pair is an output row: this is the fan-out.
  const joined: JoinedRow[] = history
    .filter((h) => byOrder.has(h.orderId))
    .map((h) => ({
      key: `j${h.id}`,
      orderId: h.orderId,
      amount: byOrder.get(h.orderId)!.amount,
      historyId: h.id,
      status: h.status,
    }));
  const latest = latestPerOrder(history);
  const fixed: JoinedRow[] = orders
    .filter((o) => latest.has(o.id))
    .map((o) => ({
      key: `f${o.id}`,
      orderId: o.id,
      amount: o.amount,
      historyId: latest.get(o.id)!.id,
      status: latest.get(o.id)!.status,
    }));
  const sum = (rows: {amount: number}[]) => rows.reduce((a, r) => a + r.amount, 0);
  const paidFixed = fixed.filter((r) => r.status === 'paid');
  return {
    joined,
    joinedCount: joined.length,
    joinedDistinctOrders: new Set(joined.map((r) => r.orderId)).size,
    naiveSum: sum(joined),
    latest,
    fixed,
    fixedCount: fixed.length,
    fixedDistinctOrders: new Set(fixed.map((r) => r.orderId)).size,
    fixedSum: sum(paidFixed),
    // Ground truth: each order counted once, if its current (latest) status is paid.
    trueTotal: sum(orders.filter((o) => latest.get(o.id)?.status === 'paid')),
    ordersTotal: sum(orders),
  };
};
