import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {computeLab, formatMoney, latestPerOrder} from '../src/labModel.ts';
import {fixture} from './helpers.ts';

describe('join demo model (what the video shows)', () => {
  const lab = fixture('join-fanout/episode.normalized.json').scenes.find((s: any) => s.type === 'tables-lab').params;

  test('join-fanout numbers: 3 orders, 9 joined rows, naive sum 1800, true total 600', () => {
    const m = computeLab(lab.orders, lab.history);
    assert.equal(m.joinedCount, 9);
    assert.equal(m.joinedDistinctOrders, 3);
    assert.equal(m.naiveSum, 1800);
    assert.equal(m.fixedCount, 3);
    assert.equal(m.fixedSum, 600);
    assert.equal(m.trueTotal, 600);
  });

  test('latest row per order: greatest timestamp wins, ties go to the greater history id', () => {
    const h = [
      {id: 1, orderId: 7, status: 'created', at: '09:00'},
      {id: 3, orderId: 7, status: 'paid', at: '09:05'},
      {id: 2, orderId: 7, status: 'authorized', at: '09:05'},
      {id: 4, orderId: 8, status: 'created', at: '10:00'},
    ];
    const latest = latestPerOrder(h);
    assert.equal(latest.get(7)?.id, 3);
    assert.equal(latest.get(8)?.id, 4);
  });

  test('money uses Indian digit grouping', () => {
    assert.equal(formatMoney(600), '₹600');
    assert.equal(formatMoney(1800), '₹1,800');
    assert.equal(formatMoney(123456), '₹1,23,456');
    assert.equal(formatMoney(-1800), '-₹1,800');
  });
});
