// The project's own screen: where it lives, a verified backup you can make at any time, how to restore one, and what this machine has.
import {useEffect, useState} from 'react';
import {getEnvironment, getProject, makeBackup, type BackupResult, type EnvCheckRow, type ProjectInfo} from './api';
import {Rail} from './Chrome';

const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0.1, n / 1e6).toFixed(1)} MB`);
const NEED: Record<EnvCheckRow['need'], string> = {app: 'Needed for everything', narration: 'Needed for narration', video: 'Needed for videos and checks', checks: 'Needed for checks'};

export function Settings({workspace, onList}: {workspace: string; onList: () => void}) {
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [env, setEnv] = useState<EnvCheckRow[] | null>(null);
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState<'backup' | 'env' | null>(null);
  const [result, setResult] = useState<BackupResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => { void getProject().then(setInfo).catch(() => setFailed('The project could not be read.')); void getEnvironment(false).then(setEnv).catch(() => undefined); }, []);
  const backup = async () => {
    setBusy('backup'); setResult(null); setFailed(null);
    const r = await makeBackup().catch(() => null);
    setBusy(null);
    if (!r || r.status !== 200) { setFailed(r?.json.message ?? 'The backup could not be made. Nothing in the project was changed.'); return; }
    setResult(r.json);
    void getProject().then(setInfo);
  };
  const recheck = async () => { setBusy('env'); setEnv(await getEnvironment(true).catch(() => env)); setDeep(true); setBusy(null); };
  const missing = (env ?? []).filter((c) => !c.ok);
  return (
    <div className="app">
      <Rail onList={false} onEpisodes={onList} />
      <div className="main plain" data-screen="settings">
        <header className="top">
          <div className="titles"><span className="crumb">{workspace}</span><h1 className="ttl">Project</h1></div>
          <span className="spacer" />
          <button className="btn" onClick={onList} data-testid="settings-back">All episodes</button>
        </header>
        <main className="page" aria-label="Project" data-testid="settings-page">
          <section className="card" data-testid="project-card">
            <h3>This project</h3>
            {info ? (
              <dl className="kv">
                <dt>Name</dt><dd>{info.name}{info.kind === 'demo' ? ' (the seeded demo)' : ''}</dd>
                <dt>Folder</dt><dd><code>{info.root}</code></dd>
                <dt>Episodes</dt><dd>{info.episodes}</dd>
                <dt>Stored with</dt><dd>database format {info.schemaVersion} (this app writes {info.appSchemaVersion}) · {info.node} · {info.platform}</dd>
                <dt>Automatic safety copies</dt><dd>{info.automaticBackups} of the database, kept inside the project and used for recovery after a crash</dd>
              </dl>
            ) : <p className="muted">{failed ?? 'Reading the project…'}</p>}
          </section>

          <section className="card" data-testid="backup-card">
            <div className="chead"><h3>Back up</h3><button className="btn sm pri" disabled={busy !== null || !info} onClick={() => void backup()} data-testid="backup-now">{busy === 'backup' ? 'Backing up…' : 'Back up now'}</button></div>
            <p>A backup is one self-contained, checksummed folder: every episode and its history, the selected narration takes, the videos and the review notes, rounds, check reports and approval records, plus the source art and the approved voice reference. It is checked after it is written.</p>
            <p className="small muted">It does not contain the installed packages, the voice models or exported packages; those are restored separately (below). It lives on this computer, so copy the folder somewhere else to protect against losing the disk.</p>
            {failed && info && <div className="errs" role="alert" data-testid="backup-error">{failed}</div>}
            {result && <div className="plannote ok" role="status" data-testid="backup-result"><b>Backed up and verified:</b> {result.name} ({mb(result.bytes ?? 0)}, {result.blobs} stored files). <div className="small">Restore it into an empty folder with <code>{result.restoreCommand}</code></div></div>}
            {info && info.backups.length > 0 && (
              <ul className="small" data-testid="backup-list">
                {info.backups.map((b) => <li key={b.name}><code>{b.name}</code> · {b.createdAt ? new Date(b.createdAt).toLocaleString() : 'unknown time'} · {mb(b.bytes)}</li>)}
              </ul>
            )}
            {info && <p className="small muted">Backups are written next to the project, in <code>{info.backupsDir}</code>.</p>}
            <details className="more"><summary>How to restore, or move the project to another place</summary>
              <ol className="small">
                <li>Stop the app (Ctrl+C in its terminal).</li>
                <li>In the explainer-studio folder run: <code>node scripts/project.ts restore &lt;backup folder&gt; &lt;an empty folder&gt;</code>. It checks every file first, refuses a damaged backup or a folder that is not empty, and leaves nothing behind if it stops partway.</li>
                <li>Open it: <code>./studio-app open &lt;that folder&gt;</code>. The path may be anywhere; nothing in a project refers to where it was.</li>
                <li>On a new computer, set up first (see below), then restore. Voice models are downloaded only when you ask for them.</li>
              </ol>
            </details>
          </section>

          <section className="card" data-testid="environment-card">
            <div className="chead"><h3>This computer</h3><button className="btn sm" disabled={busy !== null} onClick={() => void recheck()} data-testid="env-recheck">{busy === 'env' ? 'Checking…' : deep ? 'Check again' : 'Check thoroughly'}</button></div>
            {env === null ? <p className="muted">Checking…</p> : (
              <>
                <p className={missing.length ? 'warnline' : 'small muted'} data-testid="env-summary">{missing.length ? `${missing.length} thing${missing.length === 1 ? ' is' : 's are'} missing. Each says what it is needed for and how to fix it.` : 'Everything the app needs is here.'}{deep ? '' : ' The quick check does not start Python; the thorough one does.'}</p>
                <ul className="envlist">
                  {env.map((c) => (
                    <li key={c.id} data-testid={`env-${c.id}`} data-ok={c.ok ? 'yes' : 'no'}>
                      <span className={`chip sm ${c.ok ? 'green' : 'rose'}`}>{c.ok ? 'Present' : 'Missing'}</span> <b>{c.label}</b> <span className="muted small">· {NEED[c.need]} · {c.detail}</span>
                      {!c.ok && c.fix && <div className="small">{c.fix}</div>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
