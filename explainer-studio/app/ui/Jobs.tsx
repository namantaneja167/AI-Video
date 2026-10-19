import {useEffect, useState} from 'react';
import type {JobView, RebuildView} from '../jobs.ts';
import type {JobsReply} from './api';
import {whenShort} from './labels';

const clock = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

const STATE: Record<string, {label: string; cls: string}> = {
  queued: {label: 'Waiting', cls: ''}, preparing: {label: 'Starting', cls: 'acc'}, running: {label: 'Running', cls: 'acc'}, cancelling: {label: 'Stopping', cls: 'amber'},
  succeeded: {label: 'Done', cls: 'green'}, cached: {label: 'Done', cls: 'green'}, outdated: {label: 'Done, out of date', cls: 'amber'}, failed: {label: 'Failed', cls: 'rose'}, cancelled: {label: 'Cancelled', cls: ''},
};
const RB: Record<RebuildView['state'], {label: string; cls: string}> = {
  queued: {label: 'Waiting', cls: ''}, running: {label: 'In progress', cls: 'acc'}, complete: {label: 'Finished', cls: 'green'}, failed: {label: 'Failed', cls: 'rose'}, cancelled: {label: 'Cancelled', cls: ''}, stopped: {label: 'Stopped', cls: 'amber'}, paused: {label: 'Paused', cls: 'amber'},
};

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** What is known about progress, and only that: a percentage only when the worker reported a real total. */
function Progress({job, elapsed}: {job: JobView; elapsed: number | null}) {
  if (job.state !== 'running' && job.state !== 'preparing') return null;
  const d = job.detail as {audioSeconds?: number; renderedFrames?: number; totalFrames?: number} | null;
  return (
    <div className="prog" data-testid="job-progress">
      {job.fraction !== null ? <progress max={1} value={job.fraction} aria-label={`${job.label} progress`} /> : <span className="spin" aria-hidden="true" />}
      <span>{job.step ?? 'Working'}{job.fraction !== null ? ` · ${Math.round(job.fraction * 100)}%` : ''}</span>
      <span className="muted">{elapsed !== null ? `${clock(elapsed)} so far` : ''}{job.fraction === null ? ' · total time unknown' : ''}</span>
      {d?.audioSeconds !== undefined && <span className="muted">{d.audioSeconds.toFixed(1)} s of speech so far</span>}
      {d?.totalFrames ? <span className="muted">frame {d.renderedFrames ?? 0} of {d.totalFrames}</span> : null}
    </div>
  );
}

function JobRow({job, now, fetchedAt, actions}: {job: JobView; now: number; fetchedAt: number; actions: TrayActions}) {
  const [open, setOpen] = useState(false);
  const st = STATE[job.state] ?? {label: job.state, cls: ''};
  const live = job.state === 'running' || job.state === 'preparing';
  const elapsed = job.elapsedMs === null ? null : job.elapsedMs + (live ? Math.max(0, now - fetchedAt) : 0);
  return (
    <li className="job" data-job={job.id} data-state={job.state} data-testid="job-row">
      <div className="jh">
        <b>{job.label}</b>
        <span className={`chip sm ${st.cls}`}>{job.state === 'running' && <i className="spin" />}{st.label}</span>
        <span className="spacer" />
        {job.canCancel && <button className="btn sm" onClick={() => actions.cancel(job.id)}>Cancel</button>}
        {job.canRetry && <button className="btn sm" onClick={() => actions.retry(job.id)}>Retry</button>}
      </div>
      <Progress job={job} elapsed={elapsed} />
      {job.state === 'queued' && <div className="muted small">Waiting for earlier heavy work to finish. Heavy jobs run one at a time.</div>}
      {job.state === 'cancelling' && <div className="muted small">Stopping the processes this job started…</div>}
      {job.state === 'succeeded' && elapsed !== null && !job.cacheHit && <div className="muted small">Took {clock(elapsed)}.</div>}
      {job.friendlyError && <div className="jerr" role="alert">{job.friendlyError}</div>}
      {job.note && <div className="muted small">{job.note}</div>}
      <button className="linkish small" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? 'Hide details' : 'Details'}</button>
      {open && (
        <dl className="facts mono small">
          <dt>Job</dt><dd>#{job.id} · {job.kind}{job.subject ? ` · ${job.subject}` : ''}</dd>
          <dt>Built from</dt><dd>revision r{job.revision ?? '?'}</dd>
          <dt>Attempts</dt><dd>{job.attempts}</dd>
          <dt>Queued</dt><dd>{whenShort(job.createdAt)}</dd>
          {job.finishedAt && <><dt>Finished</dt><dd>{whenShort(job.finishedAt)}</dd></>}
          {job.error && <><dt>Error</dt><dd>{job.error}</dd></>}
        </dl>
      )}
    </li>
  );
}

export type TrayActions = {cancel: (id: number) => void; retry: (id: number) => void; cancelRebuild: (id: string) => void; continueRebuild: (id: string) => void; reviewRebuild: () => void};

export function JobsTray({data, fetchedAt, actions, onClose, episodeTitle}: {data: JobsReply | null; fetchedAt: number; actions: TrayActions; onClose: () => void; episodeTitle: string}) {
  const jobs = data?.jobs ?? [];
  const live = jobs.some((j) => j.state === 'running' || j.state === 'preparing');
  const now = useNow(live);
  const byRebuild = new Map<string, JobView[]>();
  for (const j of jobs) if (j.rebuildId) byRebuild.set(j.rebuildId, [...(byRebuild.get(j.rebuildId) ?? []), j]);
  return (
    <aside className="drawer" aria-label="Jobs" data-testid="jobs-tray">
      <div className="dh"><b>Jobs</b><span className="muted small">Work keeps running if you close the browser.</span><button className="btn sm" onClick={onClose}>Close</button></div>
      <div className="dbody">
        {!data && <p className="muted pad">Loading…</p>}
        {data && !data.available && <p className="muted pad">Rebuilding is not available in this session.</p>}
        {data?.available && !data.rebuilds.length && !jobs.length && <p className="muted pad">No jobs yet. After editing, use Rebuild to make a new video.</p>}
        {data?.rebuilds.map((r) => {
          const rows = (byRebuild.get(r.id) ?? []).sort((a, b) => a.id - b.id);
          const st = RB[r.state];
          return (
            <section key={r.id} className="rebuild" data-rebuild={r.id} data-state={r.state}>
              <div className="rh">
                <b>Rebuild</b><span className="small" title={r.episodeId}>{episodeTitle}</span><span className="muted small">{whenShort(r.startedAt)}{r.revision ? ` · from revision r${r.revision}` : ''}</span>
                <span className={`chip sm ${st.cls}`} data-testid="rebuild-state">{st.label}</span>
                <span className="spacer" />
                {r.canCancel && <button className="btn sm" onClick={() => actions.cancelRebuild(r.id)}>Cancel rebuild</button>}
                {r.canContinue && <button className="btn sm pri" onClick={() => actions.continueRebuild(r.id)}>Continue</button>}
                {r.pausedBecause === 'edited' && <button className="btn sm pri" data-testid="rebuild-with-edits" onClick={() => actions.reviewRebuild()}>Rebuild with my edits…</button>}
              </div>
              <div className="muted small rmsg">{r.message}</div>
              <ul className="joblist">{rows.map((j) => <JobRow key={j.id} job={j} now={now} fetchedAt={fetchedAt} actions={actions} />)}</ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
