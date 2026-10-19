// Phase 5 demonstration on the persistent demo workspace, through the real app in a real (headless) browser: a new episode is
// created from a pasted research answer, a plain script and a storyboard, using only clicks and typed or pasted text. It is the
// same steps as tests/app/planner.slow.test.ts. The app must already be running (./studio-app). Nothing is narrated or rendered.
//   node scripts/phase5_demo_ui.ts
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {ROOT, DEMO_PROJECT} from '../app/demo.ts';
import {Chrome} from '../tests/app/harness.ts';
import {createEpisodeThroughUi, type Content} from '../tests/app/planner-scenario.ts';

const PORT = 4317;
const token = readFileSync(join(DEMO_PROJECT, '.studio', 'app-token'), 'utf8').trim();
const base = `http://127.0.0.1:${PORT}`;
const OUT = resolve(ROOT, 'docs/studio/phase5-evidence');
mkdirSync(OUT, {recursive: true});

const call = async (path: string) => (await fetch(`${base}${path}`, {headers: {cookie: `studio_token=${token}`}})).json() as Promise<any>;
const library = await call('/api/library');
if (library.items.some((i: any) => i.id === 'what-is-a-token')) throw new Error('the demo workspace already has "what-is-a-token"; nothing was changed');

// The sources are deliberately modest: the author's own notes, and the existing episode in this workspace. The one link is an
// example.org placeholder, labelled as such, so that the demonstration shows how a link is recorded without citing anything real.
const content: Content = {
  title: 'What is a token?',
  audience: 'Curious beginners who have seen the context window episode',
  objective: 'Know that a model reads text in pieces called tokens, and that a token is not always a whole word',
  durationMin: '1',
  researchBroken: JSON.stringify({studioPacket: 1, sources: [{title: 'My outline for this episode'}], claims: [{text: 'A token is a piece of text a model reads.', kind: 'rumor'}]}, null, 2),
  research: JSON.stringify({
    studioPacket: 1, kind: 'research',
    sources: [
      {title: 'My outline for this episode', note: 'The author\'s own notes. Not an external source.'},
      {title: 'Context window explainer (this workspace)', note: 'The earlier episode already introduces tokens in its third line.'},
      {title: 'Placeholder tokenizer guide', url: 'https://example.org/tokenizer-guide', publisher: 'example.org', published: '2024-05-14', note: 'A placeholder address used to demonstrate how a link is recorded. Not a real source.'},
    ],
    claims: [
      {text: 'A model reads text in pieces called tokens.', kind: 'fact', sources: [1], evidence: 'Stated in the context window episode.', caveat: 'Different models cut text into different pieces.'},
      {text: 'A token is not always a whole word; it can be part of one.', kind: 'fact', sources: [2], evidence: 'Placeholder: to be checked against a real tokenizer guide.', caveat: 'The linked address is a placeholder, so this claim has no checked source yet.'},
      {text: 'Viewers already know what a model is.', kind: 'assumption'},
      {text: 'Say "pieces of text" before the word "token".', kind: 'proposed-wording'},
    ],
  }, null, 2),
  script: 'A model reads text in small pieces. Those pieces are called tokens.\n\nA token is not always a word. Sometimes it is only part of one.\n\nEvery model can only hold so many tokens at once.',
  adjust: {row: 2, text: 'A token is not always a whole word.'},
  storyboard: JSON.stringify({
    studioPacket: 1, kind: 'storyboard',
    storyboard: {scenes: [
      {segments: [1, 2], sceneType: 'cards', intention: 'Introduce tokens as pieces of text', mechanism: 'Two cards, one for the text and one for its pieces', pip: ['Pip points at the first card', 'Pip nods when the pieces appear']},
      {segments: [3, 4], sceneType: 'custom', intention: 'Show that a token can be part of a word', mechanism: 'A long word breaks apart into pieces on screen', pip: ['Pip tilts his head at the long word']},
      {segments: [5], sceneType: 'context-window', intention: 'Connect the limit to the context window', mechanism: 'The context window fills with tokens', pip: ['Pip looks at the window']},
    ]},
  }, null, 2),
};

const chrome = await Chrome.launch();
try {
  const t = await chrome.tab();
  await t.viewport(1280, 800, 1);
  await t.goto(`${base}/?token=${token}`);
  await t.waitFor('document.querySelector(".ttl")', 30000, 'the app to appear');
  const shot = async (name: string) => t.screenshot(join(OUT, `demo-${name}.png`));
  const seen = await createEpisodeThroughUi(t, content, shot);
  const plan = await call(`/api/plans/${seen.planId}`);
  const episodes = await call('/api/library');
  const result = {
    ranAt: new Date().toISOString(), planId: seen.planId, brokenPasteMessage: seen.errorText.replace(/\s+/g, ' ').trim(),
    scriptRowsAccepted: seen.rowsBeforeAccept, requestsOutsideThisApp: seen.external, consoleErrors: t.consoleErrors, failedRequests: t.failedRequests,
    plan: {sources: plan.plan.sources.length, claims: plan.plan.claims.length, scenes: plan.plan.storyboard.length, imports: plan.imports.map((i: any) => ({id: i.id, shape: i.shape, state: i.state, sha256: i.sha256, bytes: i.bytes}))},
    storyboardCheck: {producible: plan.check.producible, summary: plan.check.summary, scenes: plan.check.scenes.map((s: any) => ({id: s.id, kind: s.kind, state: s.state, blockers: s.blockers}))},
    library: episodes.items.map((i: any) => ({id: i.id, hasPlan: i.hasPlan, hasEpisode: i.hasEpisode, segments: i.segments})),
  };
  writeFileSync(join(OUT, 'demo-run.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({planId: result.planId, scriptRows: seen.rowsBeforeAccept.length, outside: seen.external.length, consoleErrors: t.consoleErrors.length, failed: t.failedRequests}, null, 1));
  if (!existsSync(join(OUT, 'demo-9-storyboard-accepted.png'))) throw new Error('screenshots were not written');
} finally {
  await chrome.close();
}
