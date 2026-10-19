// The editor lists a video as out of date when the render sources it was made from have changed, not only when its own inputs did.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Status} from '../../core/artifacts.ts';
import {staleItems, withRenderDrift} from '../../app/shared/costs.ts';
import {getEpisode} from '../../core/episodes.ts';
import {EP, fakeWorkspace} from './jobs-fixture.ts';

const status = (final: string): Status => {
  const e = (s: string) => ({status: s, reasons: [] as string[]});
  return {takes: {b1: e('fresh')}, timing: e('fresh'), mix: {draft: e('none'), final: e('fresh')}, render: {draft: e('none'), final: e(final)}} as unknown as Status;
};

test('a fresh final video is listed as out of date when its render sources changed, with the reason', async () => {
  const w = fakeWorkspace();
  try {
    const doc = getEpisode(w.p, EP);
    const base = staleItems(status('fresh'), doc, null);
    assert.deepEqual(base.stale, []);
    const items = withRenderDrift(base, status('fresh'), ['code: package.json changed', 'theme: src/theme.ts changed'], null);
    assert.equal(items.stale.length, 1);
    assert.equal(items.stale[0].label, 'Final video');
    assert.match(items.stale[0].why[0], /render sources changed since it was built \(code: package\.json changed; theme: src\/theme\.ts changed\)/);
  } finally { await w.close(); }
});

test('nothing is added when the sources match, when no final video exists, or when it is already listed', async () => {
  const w = fakeWorkspace();
  try {
    const doc = getEpisode(w.p, EP);
    const none = staleItems(status('none'), doc, null);
    assert.equal(withRenderDrift(none, status('none'), ['code: x changed'], null), none, 'nothing built, nothing to be out of date');
    const fresh = staleItems(status('fresh'), doc, null);
    assert.equal(withRenderDrift(fresh, status('fresh'), [], null), fresh);
    const stale = staleItems(status('stale'), doc, null);
    assert.equal(withRenderDrift(stale, status('stale'), ['code: x changed'], null).stale.length, 1, 'already stale for its own reasons: not listed twice');
  } finally { await w.close(); }
});
