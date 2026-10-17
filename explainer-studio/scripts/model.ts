// Usage: node scripts/model.ts <episode.json>  -> prints the join-demo numbers as JSON.
// `studio.py verify` compares this against an independent SQLite computation.
import {readFileSync} from 'node:fs';
import {computeLab, formatMoney} from '../src/labModel.ts';

const ep = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const scene = ep.scenes.find((s: {type: string}) => s.type === 'tables-lab');
if (!scene) {
  console.log('{}');
} else {
  const {orders, history, currency} = scene.params;
  const m = computeLab(orders, history);
  console.log(
    JSON.stringify({
      joinedCount: m.joinedCount,
      joinedDistinctOrders: m.joinedDistinctOrders,
      naiveSum: m.naiveSum,
      fixedCount: m.fixedCount,
      fixedDistinctOrders: m.fixedDistinctOrders,
      fixedSum: m.fixedSum,
      trueTotal: m.trueTotal,
      formatted: {naiveSum: formatMoney(m.naiveSum, currency), trueTotal: formatMoney(m.trueTotal, currency)},
    }),
  );
}
