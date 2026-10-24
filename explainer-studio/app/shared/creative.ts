// The creative checkpoint of an episode: hook options, the exact takeaway, claim-to-source evidence and the opening animatic, read
// from fields the plan already has (no new schema):
//   * hook options  = claims of kind "proposed-wording" whose id starts with "hook" (hook1, hook2, ...); the text is the hook
//   * the takeaway  = the claim with id "takeaway" (text = the exact takeaway shown on the last scene; sourceIds + evidence = what it
//                     was assessed against; caveat = the limit it states)
//   * facts         = claims of kind "fact" with their sources and evidence
//   * demand        = the claim with id "demand": dated audience-interest evidence, or a statement that demand is unverified
//   * brief         = the plan's audience and objective; the visible demonstration = a storyboard scene's mechanism
// Everything here is ADVISORY: the report is read by the planning page and never blocks a build. The only enforced rule is the
// episode's own schema (an opening hook is at most 48 characters). Pure and shared by the browser and the tests.
import type {EpisodeV2} from '../../src/schema2.ts';
import {HOOK_MAX, hookAdvice} from './opening.ts';
import type {Claim, PlanDoc} from './plan.ts';

export type Tone = 'pass' | 'warn' | 'fail' | 'todo';
export type CreativeItem = {id: string; title: string; status: Tone; detail: string};
export type HookOption = {id: string; text: string; chars: number; words: number; chosen: boolean; issues: string[]};
export type AnimaticView = {state: 'none' | 'running' | 'fresh' | 'outdated'} | null;
export type CreativeReport = {
  hookOptions: HookOption[];
  takeaway: {text: string; sourceIds: string[]; evidence: string; caveat: string} | null;
  items: CreativeItem[];
  /** Things the checklist cannot judge: they are for a person. Listed so they are not mistaken for checks Studio runs. */
  guidance: string[];
  counts: Record<Tone, number>;
};

export const HOOK_CLAIM = /^hook([-_]?[a-z0-9]+)*$/;
export const TAKEAWAY_CLAIM = 'takeaway';
export const DEMAND_CLAIM = 'demand';
export const MIN_HOOK_OPTIONS = 3;

/** Documented guidance that Studio does NOT check. Shown next to the checks, labelled as such. */
export const GUIDANCE: string[] = [
  'Listen to the generated narration, including how names and terms are pronounced; whether it sounds natural is a human judgement, and listening approval is recorded separately.',
  'Watch the finished video at full speed at phone size, with captions, including the opening, every transition and the ending.',
  'Look at a contact sheet of the opening, each stage and the ending, and confirm nothing important sits under the captions or the header.',
  'Confirm the cover is the clean opening frame and that the hook on it matches the video.',
  'Gather dated evidence that the audience wants the topic; a hook that feels strong is a hypothesis, not a result.',
  'Check each cited source yourself and mark it checked; Studio never fetches or verifies a link.',
  'Approve the exact finished video, cover and caption yourself before anything is published.',
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const words = (s: string) => norm(s).replace(/[^a-z0-9\u00c0-\u024f ]+/g, ' ').split(' ').filter(Boolean);
const STOP = new Set(['the', 'and', 'that', 'this', 'with', 'your', 'you', 'for', 'are', 'can', 'its', 'from', 'but', 'not']);

export const isHookClaim = (c: Claim) => c.kind === 'proposed-wording' && HOOK_CLAIM.test(c.id);

/** How much of the takeaway's content words the last lines of the narration actually say. 1 when it has none to compare. */
export function takeawaySpoken(takeaway: string, lastLines: string): number {
  const want = words(takeaway).filter((w) => w.length >= 4 && !STOP.has(w));
  if (!want.length) return 1;
  const said = new Set(words(lastLines));
  return want.filter((w) => said.has(w)).length / want.length;
}

export function creativeReport(plan: PlanDoc, doc: EpisodeV2 | null, animatic: AnimaticView): CreativeReport {
  const items: CreativeItem[] = [];
  const add = (id: string, title: string, status: Tone, detail: string) => items.push({id, title, status, detail});
  const chosenHook = doc?.scenes[0]?.openingHook ? norm(doc.scenes[0].openingHook) : null;

  // ---- hook options ----
  const hookOptions: HookOption[] = plan.claims.filter(isHookClaim).map((c) => {
    const text = c.text.trim();
    const adv = hookAdvice(text);
    const issues: string[] = [];
    if (text.length > HOOK_MAX) issues.push(`${text.length} characters; at most ${HOOK_MAX} fit the opening`);
    if (adv.note) issues.push(adv.note);
    return {id: c.id, text, chars: text.length, words: adv.words, chosen: chosenHook !== null && norm(text) === chosenHook, issues};
  });
  const distinct = new Set(hookOptions.map((h) => norm(h.text))).size;
  add('hook-options', `At least ${MIN_HOOK_OPTIONS} hook options`, distinct >= MIN_HOOK_OPTIONS ? 'pass' : distinct === 0 ? 'todo' : 'warn',
    distinct >= MIN_HOOK_OPTIONS ? `${distinct} different options are recorded.` : `${distinct} option${distinct === 1 ? '' : 's'} recorded; add claims of kind "proposed-wording" with ids hook1, hook2, hook3.`);
  const tooLong = hookOptions.filter((h) => h.chars > HOOK_MAX);
  const offLength = hookOptions.filter((h) => h.chars <= HOOK_MAX && h.issues.length);
  if (hookOptions.length) add('hook-fit', `Each option fits the opening (${HOOK_MAX} characters)`, tooLong.length ? 'fail' : offLength.length ? 'warn' : 'pass',
    tooLong.length ? `${tooLong.map((h) => h.id).join(', ')} too long to save as the hook.` : offLength.length ? `${offLength.map((h) => `${h.id}: ${h.issues[0]}`).join('; ')}.` : 'All fit, and read 4 to 8 words.');
  if (doc) {
    const hook = doc.scenes[0]?.openingHook;
    if (!hook) add('hook-chosen', 'A hook is chosen', 'todo', 'The first scene has no opening hook yet.');
    else if (hookOptions.length && !hookOptions.some((h) => h.chosen)) add('hook-chosen', 'The chosen hook is one of the options', 'warn', `The episode's hook "${hook}" is not among the recorded options.`);
    else add('hook-chosen', 'A hook is chosen', 'pass', `"${hook}"`);
    if (hook) {
      const first = doc.narration.segments[0];
      const said = takeawaySpoken(hook, first ? (first.speech ?? first.text) : '');
      add('hook-spoken', 'The first spoken sentence carries the hook', said >= 0.6 ? 'pass' : 'warn',
        said >= 0.6 ? 'The opening line says the hook\'s key words, so the cover, the opening and the voice make the same promise.' : `The opening line says ${Math.round(said * 100)}% of the hook's key words (a word-match heuristic, not a judgement).`);
    }
  }

  // ---- takeaway ----
  const tk = plan.claims.find((c) => c.id === TAKEAWAY_CLAIM) ?? null;
  const takeaway = tk ? {text: tk.text.trim(), sourceIds: tk.sourceIds, evidence: tk.evidence.trim(), caveat: tk.caveat.trim()} : null;
  if (!takeaway) add('takeaway', 'The exact takeaway is written', 'todo', 'Add a claim with id "takeaway": its text is the line the last scene shows.');
  else {
    add('takeaway', 'The exact takeaway is written', 'pass', `"${takeaway.text}"`);
    const known = new Set(plan.sources.map((s) => s.id));
    const cited = takeaway.sourceIds.filter((s) => known.has(s));
    add('takeaway-evidence', 'The takeaway is assessed against sources', !cited.length ? 'fail' : !takeaway.evidence ? 'warn' : 'pass',
      !cited.length ? 'It cites no source from this plan.' : !takeaway.evidence ? 'It cites a source but does not say what the source supports.' : `Assessed against ${cited.join(', ')}.`);
    add('takeaway-limit', 'The takeaway states its limit', takeaway.caveat ? 'pass' : 'warn', takeaway.caveat ? 'A caveat is recorded.' : 'No caveat is recorded; say where the advice stops applying.');
    if (doc) {
      const segs = doc.narration.segments;
      const said = takeawaySpoken(takeaway.text, segs.slice(-2).map((s) => s.speech ?? s.text).join(' '));
      add('takeaway-spoken', 'The narration ends on the takeaway', said >= 0.6 ? 'pass' : 'warn',
        said >= 0.6 ? 'The closing lines say its key words.' : `The last two lines say ${Math.round(said * 100)}% of its key words (a word-match heuristic, not a judgement).`);
    }
  }

  // ---- claims and sources ----
  const facts = plan.claims.filter((c) => c.kind === 'fact');
  const known = new Set(plan.sources.map((s) => s.id));
  const noSource = facts.filter((c) => !c.sourceIds.some((s) => known.has(s)));
  const noEvidence = facts.filter((c) => !c.evidence.trim());
  if (!facts.length) add('claims', 'Every factual claim has a source and evidence', 'todo', 'No factual claims are recorded yet.');
  else add('claims', 'Every factual claim has a source and evidence', noSource.length ? 'fail' : noEvidence.length ? 'warn' : 'pass',
    noSource.length ? `Without a source: ${noSource.map((c) => c.id).join(', ')}.` : noEvidence.length ? `Without a note of what the source says: ${noEvidence.map((c) => c.id).join(', ')}.` : `${facts.length} claim${facts.length === 1 ? '' : 's'}, all with sources and evidence.`);
  const used = plan.sources.filter((s) => plan.claims.some((c) => c.sourceIds.includes(s.id)));
  const unchecked = used.filter((s) => !s.checked);
  if (used.length) add('sources-checked', 'Cited sources are marked checked', unchecked.length ? 'warn' : 'pass',
    unchecked.length ? `${unchecked.length} of ${used.length} cited sources are not marked checked (only you can mark one; Studio never fetches a link).` : 'All cited sources are marked checked by you.');

  // ---- brief, demonstration and demand ----
  const briefMissing = [!plan.audience.trim() && 'the intended viewer', !plan.objective.trim() && 'the reason to care / objective'].filter(Boolean);
  add('brief', 'The viewer and the reason to care are recorded', briefMissing.length ? 'todo' : 'pass', briefMissing.length ? `Missing: ${briefMissing.join(' and ')}.` : 'Audience and objective are set.');
  const shown = plan.storyboard.find((sc) => sc.mechanism.trim());
  add('demonstration', 'One visible demonstration is named', shown ? 'pass' : 'todo', shown ? `Scene ${shown.id} says what moves and changes.` : 'No storyboard scene has a mechanism yet: say what the viewer sees happen.');
  const demand = plan.claims.find((c) => c.id === DEMAND_CLAIM);
  add('demand', 'Audience demand is evidenced or marked unverified', demand?.text.trim() ? 'pass' : 'todo',
    demand?.text.trim() ? `Recorded: "${demand.text.trim().slice(0, 120)}"` : 'Add a claim with id "demand": dated audience-interest evidence, or say demand is unverified. "Viral potential" is a hypothesis.');

  // ---- opening ----
  if (doc?.scenes[0]?.seriesLabel) {
    const label = words(doc.scenes[0].seriesLabel).filter((w) => !/^\d+$/.test(w));
    const intro = new Set(words(doc.narration.segments.slice(0, 2).map((s) => s.speech ?? s.text).join(' ')));
    const missing = label.filter((w) => !intro.has(w));
    add('series-intro', 'The series is said aloud in the opening', missing.length ? 'warn' : 'pass',
      missing.length ? `The first two lines do not say: ${missing.join(' ')}.` : `The opening narration says "${doc.scenes[0].seriesLabel}"'s words.`);
  }
  if (doc) {
    const st = animatic?.state ?? 'none';
    add('animatic', 'The five-second opening animatic is drawn for this version', st === 'fresh' ? 'pass' : st === 'outdated' ? 'warn' : 'todo',
      st === 'fresh' ? 'It matches the current hook, script and scenes. Whether it works is for you to watch.' : st === 'outdated' ? 'The hook, script, scenes or render sources changed since it was drawn.' : st === 'running' ? 'It is being drawn.' : 'Not drawn yet; it needs no narration and uses a guessed clock.');
  }

  const counts: Record<Tone, number> = {pass: 0, warn: 0, fail: 0, todo: 0};
  for (const i of items) counts[i.status]++;
  return {hookOptions, takeaway, items, guidance: GUIDANCE, counts};
}
