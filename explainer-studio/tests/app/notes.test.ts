// Review notes: the pure edit, the schema, the revision summary, and that a note changes nothing a rebuild acts on.
import assert from 'node:assert/strict';
import {after, before, describe, test} from 'node:test';
import {addNote} from '../../app/shared/edit.ts';
import {summarizeChange} from '../../app/shared/revisions.ts';
import {statusReport} from '../../core/artifacts.ts';
import {getEpisode} from '../../core/episodes.ts';
import {EpisodeSchemaV2} from '../../src/schema2.ts';
import {EP, edit, fakeWorkspace, type FakeWorkspace} from './jobs-fixture.ts';

let w: FakeWorkspace;
before(() => { w = fakeWorkspace(); });
after(async () => { await w.close(); });

describe('review notes', () => {
  test('addNote gives the next free id, trims, refuses empty text, and never changes its input', () => {
    const doc = getEpisode(w.p, EP);
    const before = JSON.stringify(doc);
    assert.equal(addNote(doc, {text: '   ', type: 'general'}), null);
    const one = addNote(doc, {text: '  Slow down here.  ', type: 'voice', timeSec: 3.456, segment: 's2', render: {id: '5', kind: 'final'}})!;
    assert.deepEqual(one.note, {id: 'n1', text: 'Slow down here.', type: 'voice', status: 'open', anchor: {segment: 's2'}, timeSec: 3.46, render: {id: '5', kind: 'final'}});
    const two = addNote({...one.doc, reviewNotes: [{...one.note, id: 'n2'}]}, {text: 'Another', type: 'general'})!;
    assert.equal(two.note.id, 'n3', 'an id already used by n2 and one note present: skips to a free id');
    assert.equal(JSON.stringify(doc), before);
    assert.doesNotThrow(() => EpisodeSchemaV2.parse(one.doc), 'the document with a note is still a valid episode');
  });

  test('a note without a time (no build yet) is valid', () => {
    const r = addNote(getEpisode(w.p, EP), {text: 'Check the opening.', type: 'general', segment: 's1'})!;
    assert.equal(r.note.timeSec, undefined);
    assert.doesNotThrow(() => EpisodeSchemaV2.parse(r.doc));
  });

  test('the revision summary says a note was added, and what a note edit is not', () => {
    const doc = getEpisode(w.p, EP);
    const withNote = addNote(doc, {text: 'x', type: 'general'})!.doc;
    assert.deepEqual(summarizeChange(doc, withNote), ['Note added']);
    const two = addNote(withNote, {text: 'y', type: 'general'})!.doc;
    assert.deepEqual(summarizeChange(doc, two), ['2 notes added']);
    assert.deepEqual(summarizeChange(two, {...two, reviewNotes: []}), ['Notes changed']);
  });

  test('saving a note leaves every stage fresh: no take, timing, mix or render becomes stale and the rebuild plan does not change', () => {
    const fresh = () => { const s = statusReport(w.p, EP); return [...Object.values(s.takes).map((t) => t.status), s.timing.status, s.mix.final.status, s.render.final.status]; };
    const before = fresh();
    const planBefore = w.svc.plan(EP).steps.map((x) => `${x.key}:${x.action}`); // (this workspace's takes are stale against the fake voice runtime, so some steps run either way)
    edit(w.p, (d) => addNote(d, {text: 'Pause longer after this.', type: 'timing', timeSec: 4.2, segment: 's3'})!.doc);
    assert.deepEqual(fresh(), before, 'statuses are the same as before the note');
    assert.deepEqual(w.svc.plan(EP).steps.map((x) => `${x.key}:${x.action}`), planBefore, 'the rebuild plan is the same: a note adds no work');
    assert.equal(getEpisode(w.p, EP).reviewNotes.length, 1);
  });
});
