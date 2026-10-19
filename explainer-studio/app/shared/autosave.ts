// The save state machine for one episode. "Saved" is shown only after the server has committed the document.
// Unsaved edits are kept (in memory and in a small local draft) until a save succeeds or the author discards them.
import type {EpisodeV2} from '../../src/schema2.ts';

export type Committed = {doc: EpisodeV2; seq: number};
export type SendResult =
  | {kind: 'ok'; seq: number}
  | {kind: 'conflict'; current: Committed}
  | {kind: 'invalid'; message: string}
  | {kind: 'failed'; message: string};

export type SaveState =
  | {kind: 'saved'}
  | {kind: 'unsaved'}
  | {kind: 'saving'}
  | {kind: 'failed'; message: string}
  | {kind: 'invalid'; message: string}
  | {kind: 'conflict'; theirs: Committed};

export type Draft = {baseSeq: number; doc: EpisodeV2; at: number};
export type KV = {get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void};
export type Timers = {set(fn: () => void, ms: number): unknown; clear(handle: unknown): void};

export type AutosaveOptions = {
  episodeId: string;
  committed: Committed;
  send: (doc: EpisodeV2, baseSeq: number) => Promise<SendResult>;
  store: KV;
  timers?: Timers;
  delayMs?: number;
  now?: () => number;
  onChange?: () => void;
};

const realTimers: Timers = {set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export class Autosave {
  state: SaveState = {kind: 'saved'};
  committed: Committed;
  /** The document the author sees and edits. */
  doc: EpisodeV2;
  /** Set when unsaved edits from an earlier session were put back. */
  restored: 'edits' | 'conflict' | null = null;
  private o: Required<Omit<AutosaveOptions, 'onChange'>> & {onChange?: () => void};
  private timer: unknown = null;
  private inFlight = false;
  private dirtyWhileSaving = false;
  private key: string;

  constructor(o: AutosaveOptions) {
    this.o = {timers: realTimers, delayMs: 500, now: Date.now, ...o};
    this.key = `studio.draft.${o.episodeId}`;
    this.committed = o.committed;
    this.doc = o.committed.doc;
    this.restoreDraft();
  }

  private emit() { this.o.onChange?.(); }
  private set(state: SaveState) { this.state = state; this.emit(); }
  get dirty(): boolean { return !same(this.doc, this.committed.doc); }

  private restoreDraft() {
    const raw = this.o.store.get(this.key);
    if (!raw) return;
    let d: Draft;
    try { d = JSON.parse(raw); } catch { this.o.store.remove(this.key); return; }
    if (same(d.doc, this.committed.doc)) { this.o.store.remove(this.key); return; }
    this.doc = d.doc;
    if (d.baseSeq === this.committed.seq) {
      this.restored = 'edits';
      this.state = {kind: 'unsaved'};
      this.schedule();
    } else {
      // The saved version moved on while these edits were not yet saved: the author decides.
      this.restored = 'conflict';
      this.state = {kind: 'conflict', theirs: this.committed};
    }
  }

  private writeDraft() {
    if (this.dirty) this.o.store.set(this.key, JSON.stringify({baseSeq: this.committed.seq, doc: this.doc, at: this.o.now()} satisfies Draft));
    else this.o.store.remove(this.key);
  }

  private schedule() {
    if (this.timer) this.o.timers.clear(this.timer);
    this.timer = this.o.timers.set(() => { this.timer = null; void this.flush(); }, this.o.delayMs);
  }

  /** Every edit goes through here. The edit is visible at once and the draft is kept before any save is attempted. */
  edit(doc: EpisodeV2): void {
    this.doc = doc;
    this.restored = this.restored === 'conflict' ? 'conflict' : null;
    this.writeDraft();
    if (this.state.kind === 'conflict') { this.emit(); return; } // wait for the author's choice
    if (!this.dirty) { if (this.timer) this.o.timers.clear(this.timer); this.timer = null; if (!this.inFlight) this.set({kind: 'saved'}); else this.dirtyWhileSaving = true; return; }
    if (this.inFlight) { this.dirtyWhileSaving = true; this.emit(); return; }
    this.set({kind: 'unsaved'});
    this.schedule();
  }

  /** Save now (also what the Retry button calls). */
  async flush(): Promise<void> {
    if (this.timer) { this.o.timers.clear(this.timer); this.timer = null; }
    if (!this.dirty || this.inFlight || this.state.kind === 'conflict') return;
    this.inFlight = true;
    this.dirtyWhileSaving = false;
    this.set({kind: 'saving'});
    const sent = this.doc;
    let r: SendResult;
    try { r = await this.o.send(sent, this.committed.seq); } catch (e) { r = {kind: 'failed', message: (e as Error).message || 'The save could not be sent.'}; }
    this.inFlight = false;
    if (r.kind === 'ok') {
      this.committed = {doc: sent, seq: r.seq};
      this.writeDraft();
      if (this.dirty) { this.set({kind: 'unsaved'}); this.schedule(); } else this.set({kind: 'saved'});
    } else if (r.kind === 'conflict') {
      this.set({kind: 'conflict', theirs: r.current});
    } else if (r.kind === 'invalid') {
      this.set({kind: 'invalid', message: r.message});
    } else {
      this.set({kind: 'failed', message: r.message});
    }
  }

  /** The author keeps their edits over the newer saved version: they are saved on top of it. */
  async keepMine(): Promise<void> {
    if (this.state.kind !== 'conflict') return;
    this.committed = this.state.theirs;
    this.restored = null;
    this.writeDraft();
    this.set(this.dirty ? {kind: 'unsaved'} : {kind: 'saved'});
    await this.flush();
  }

  /** The author takes the newer saved version; their unsaved edits are discarded. */
  takeTheirs(): void {
    if (this.state.kind !== 'conflict') return;
    this.committed = this.state.theirs;
    this.doc = this.committed.doc;
    this.restored = null;
    this.o.store.remove(this.key);
    this.set({kind: 'saved'});
  }

  /** Another tab or session committed a newer version. Adopted silently only when nothing here is unsaved. */
  external(c: Committed): boolean {
    if (c.seq <= this.committed.seq) return false;
    if (this.dirty || this.inFlight) return false;
    this.committed = c;
    this.doc = c.doc;
    this.o.store.remove(this.key);
    this.set({kind: 'saved'});
    return true;
  }

  discardEdits(): void {
    this.doc = this.committed.doc;
    this.restored = null;
    this.o.store.remove(this.key);
    if (this.timer) this.o.timers.clear(this.timer);
    this.timer = null;
    this.set({kind: 'saved'});
  }
}
