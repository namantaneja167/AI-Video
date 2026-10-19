// Reading what the author pasted or opened from a ChatGPT conversation. Pure: text in, a proposal or exact errors out.
// Nothing here touches the network, the disk or any model. Whatever the text says (including anything that reads like
// an instruction) is data: it is checked, shown and stored, never acted on.
import {z} from 'zod';
import {SceneSchemaV2} from '../../src/schema2.ts';
import {CLAIM_KINDS, isHttpUrl, pathOf, type ClaimKind} from './plan.ts';

export const PACKET_VERSION = 1;
export const MAX_INPUT_CHARS = 400_000;
export const MAX_SEGMENTS = 200;
/** The scene types the episode schema has (parameters can only be checked for these). */
const SCENE_TYPE_IDS: string[] = SceneSchemaV2.options.map((o) => o.shape.type.value as string);

export type ProposedSource = {title: string; url: string | null; publisher: string; published: string; note: string};
/** `sources` entries are positions in this packet's own source list (from 0) or ids of sources already in the plan. */
export type ProposedClaim = {text: string; kind: ClaimKind; sources: (number | string)[]; evidence: string; caveat: string};
export type ProposedSegment = {text: string; speech?: string; pauseAfter?: number; /** Paragraph the text came from, for plain scripts. */ para?: number; flags?: ('long' | 'short')[]};
/** `segments` are positions in the script (from 1). */
export type ProposedScene = {segments: number[]; sceneType: string; intention: string; mechanism: string; pip: string[]; params?: Record<string, unknown>};

export type Shape = 'json' | 'markdown-json' | 'script';
export const SHAPE_LABEL: Record<Shape, string> = {json: 'JSON', 'markdown-json': 'Markdown with a JSON block', script: 'Plain script'};
export type Proposal = {shape: Shape; sources: ProposedSource[]; claims: ProposedClaim[]; script: ProposedSegment[] | null; storyboard: ProposedScene[] | null; notes: string[]};
export type ParseError = {path: string; message: string};
export type ParseResult = {ok: true; proposal: Proposal} | {ok: false; shape: Shape | null; errors: ParseError[]};
/** What the packet may refer to that it does not contain itself. */
export type ParseContext = {existingSourceIds: string[]; existingScriptSegments: number | null};

// ---- the packet schema ----------------------------------------------------------------------------------------------
const str = (max: number) => z.string().max(max);
const optStr = (max: number) => z.string().max(max).optional();
const PSource = z.object({
  title: z.string().trim().min(1).max(300),
  url: z.string().max(2000).refine((u) => u.trim() === '' || isHttpUrl(u.trim()), 'must be an http or https link (or left out). Nothing is opened or fetched').nullable().optional(),
  publisher: optStr(200),
  published: z.string().regex(/^(\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?)?$/, 'use YYYY, YYYY-MM or YYYY-MM-DD, or leave it out when unknown').optional(),
  note: optStr(3000),
}).strict();
const PClaim = z.object({
  text: z.string().trim().min(1).max(1500),
  kind: z.enum(CLAIM_KINDS),
  sources: z.array(z.union([z.number().int().min(0), z.string().regex(/^[a-z0-9][a-z0-9_-]*$/)])).max(20).optional(),
  evidence: optStr(3000),
  caveat: optStr(3000),
}).strict();
const PSegment = z.object({
  text: z.string().trim().min(1).max(1500),
  speech: optStr(1500),
  pauseAfter: z.number().min(0).max(5).optional(),
}).strict();
const PScene = z.object({
  segments: z.array(z.number().int().min(1)).min(1).max(200),
  sceneType: z.string().trim().min(1).max(60),
  intention: optStr(1500),
  mechanism: optStr(1500),
  pip: z.array(str(400).min(1)).max(12).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
}).strict();
const Packet = z.object({
  studioPacket: z.literal(PACKET_VERSION),
  kind: z.enum(['research', 'script', 'storyboard', 'bundle']).optional(),
  sources: z.array(PSource).max(200).optional(),
  claims: z.array(PClaim).max(400).optional(),
  script: z.object({segments: z.array(PSegment).min(1).max(MAX_SEGMENTS)}).strict().optional(),
  storyboard: z.object({scenes: z.array(PScene).min(1).max(100)}).strict().optional(),
}).strict();

// ---- errors with exact places -------------------------------------------------------------------------------------------
const typeName = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'a list' : v === undefined ? 'nothing' : `a ${typeof v}`);
const valueAt = (data: unknown, path: PropertyKey[]): unknown => path.reduce<any>((d, k) => (d === null || d === undefined ? undefined : d[k as any]), data);

function describe(issue: z.core.$ZodIssue, data: unknown): ParseError[] {
  const path = issue.path;
  const at = pathOf(path);
  const field = String(path[path.length - 1] ?? 'value');
  switch (issue.code) {
    case 'invalid_type': {
      const got = valueAt(data, path);
      if (got === undefined) return [{path: at, message: `"${field}" is required`}];
      return [{path: at, message: `must be ${issue.expected === 'array' ? 'a list' : `a ${issue.expected}`}, but it is ${typeName(got)}`}];
    }
    case 'unrecognized_keys': return issue.keys.map((k) => ({path: pathOf([...path, k]), message: `"${k}" is not a field this format has. Remove it`}));
    case 'invalid_value': {
      const got = valueAt(data, path);
      if (got === undefined) return [{path: at, message: `"${field}" is required`}];
      return [{path: at, message: `must be ${issue.values.length === 1 ? JSON.stringify(issue.values[0]) : `one of ${issue.values.map((v) => JSON.stringify(v)).join(', ')}`}, but it is ${JSON.stringify(got)}`}];
    }
    case 'too_small': return [{path: at, message: issue.origin === 'string' ? 'must not be empty' : issue.origin === 'array' ? `needs at least ${String(issue.minimum)} item${issue.minimum === 1 ? '' : 's'}` : `must be at least ${String(issue.minimum)}`}];
    case 'too_big': return [{path: at, message: issue.origin === 'string' ? `is too long (at most ${String(issue.maximum)} characters)` : issue.origin === 'array' ? `has too many items (at most ${String(issue.maximum)})` : `must be at most ${String(issue.maximum)}`}];
    case 'invalid_union': return [{path: at, message: 'must be a source number from the packet (starting at 0) or the id of an existing source such as "src1"'}];
    default: return [{path: at, message: issue.message}];
  }
}

function locate(text: string, pos: number, lineOffset: number): string {
  const before = text.slice(0, pos);
  const line = before.split('\n').length + lineOffset;
  const col = pos - (before.lastIndexOf('\n') + 1) + 1;
  return `line ${line}, column ${col}`;
}

/** The first place the text stops being JSON, and why. V8's own messages do not always say where, so this reads it again. */
export function scanJson(t: string): {pos: number; message: string} | null {
  let i = 0;
  const ws = () => { while (i < t.length && /[ \t\n\r]/.test(t[i])) i++; };
  const fail = (message: string, at = i): never => { throw {pos: at, message}; };
  const show = (c: string) => (c === '\n' ? 'a line break' : `"${c}"`);
  const string = () => {
    i++;
    while (i < t.length) {
      const c = t[i];
      if (c === '"') { i++; return; }
      if (c === '\\') {
        const e = t[i + 1];
        if (e === 'u' ? !/^[0-9a-fA-F]{4}$/.test(t.slice(i + 2, i + 6)) : !'"\\/bfnrt'.includes(e ?? '#')) fail('a backslash in a string must start a valid escape such as \\n or \\"');
        i += e === 'u' ? 6 : 2;
      } else if (c < ' ') fail('a line break inside a string; write \\n instead');
      else i++;
    }
    fail('the string is never closed', t.length);
  };
  const number = () => { const m = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y; m.lastIndex = i; if (!m.exec(t)) fail('this is not a valid number'); i = m.lastIndex; };
  const value = (): void => {
    ws();
    const c = t[i];
    if (c === undefined) fail('the text ends where a value should be');
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    for (const lit of ['true', 'false', 'null']) if (t.startsWith(lit, i)) { i += lit.length; return; }
    fail(`unexpected ${show(c)} where a value should be`);
  };
  const object = () => {
    i++; ws();
    if (t[i] === '}') { i++; return; }
    for (;;) {
      ws();
      if (t[i] === undefined) fail('the text ends inside an object', t.length);
      if (t[i] === '}') fail('a comma just before "}" is not allowed');
      if (t[i] !== '"') fail('expected a property name in double quotes');
      string(); ws();
      if (t[i] !== ':') fail("expected ':' after the property name");
      i++; value(); ws();
      if (t[i] === ',') { i++; continue; }
      if (t[i] === '}') { i++; return; }
      fail(t[i] === undefined ? 'the text ends inside an object' : "expected ',' or '}' after the value", t[i] === undefined ? t.length : i);
    }
  };
  const array = () => {
    i++; ws();
    if (t[i] === ']') { i++; return; }
    for (;;) {
      value(); ws();
      if (t[i] === ',') { i++; ws(); if (t[i] === ']') fail('a comma just before "]" is not allowed'); continue; }
      if (t[i] === ']') { i++; return; }
      fail(t[i] === undefined ? 'the text ends inside a list' : "expected ',' or ']' after the value", t[i] === undefined ? t.length : i);
    }
  };
  try { value(); ws(); if (i < t.length) fail('extra text after the end of the JSON'); } catch (e) { if (e && typeof e === 'object' && 'pos' in e) return e as {pos: number; message: string}; throw e; }
  return null;
}

// ---- finding the JSON ------------------------------------------------------------------------------------------------------
const FENCE = /^[ \t]*```([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
function jsonBlocks(text: string): {body: string; line: number; lang: string}[] {
  const out: {body: string; line: number; lang: string}[] = [];
  for (const m of text.matchAll(FENCE)) {
    const lang = m[1].toLowerCase();
    const body = m[2];
    if (lang === 'json' || ((lang === '' || lang === 'jsonc') && body.trimStart().startsWith('{'))) out.push({body, line: text.slice(0, m.index).split('\n').length, lang});
  }
  return out;
}

export function parseInput(raw: string, ctx: ParseContext): ParseResult {
  if (raw.length > MAX_INPUT_CHARS) return {ok: false, shape: null, errors: [{path: '(input)', message: `is too long (${raw.length.toLocaleString('en-US')} characters; the limit is ${MAX_INPUT_CHARS.toLocaleString('en-US')})`}]};
  const text = raw.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  if (!text.trim()) return {ok: false, shape: null, errors: [{path: '(input)', message: 'nothing was pasted or opened'}]};
  const t = text.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return fromJson(text, 'json', 0, ctx);
  const blocks = jsonBlocks(text);
  if (blocks.length > 1) return {ok: false, shape: 'markdown-json', errors: [{path: '(input)', message: `contains ${blocks.length} JSON blocks (starting at lines ${blocks.map((b) => b.line).join(', ')}); keep exactly one so that nothing is guessed`}]};
  if (blocks.length === 1) return fromJson(blocks[0].body, 'markdown-json', blocks[0].line, ctx);
  return fromScript(text);
}

function fromJson(body: string, shape: Shape, lineOffset: number, ctx: ParseContext): ParseResult {
  let data: unknown;
  try { data = JSON.parse(body); } catch (e) {
    const at = scanJson(body);
    if (at) return {ok: false, shape, errors: [{path: `(${locate(body, at.pos, lineOffset)})`, message: `this is not valid JSON: ${at.message}`}]};
    return {ok: false, shape, errors: [{path: '(input)', message: `this is not valid JSON: ${(e as Error).message}`}]};
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {ok: false, shape, errors: [{path: '(root)', message: `must be one JSON object with "studioPacket": ${PACKET_VERSION}, but it is ${typeName(data)}`}]};
  const r = Packet.safeParse(data);
  if (!r.success) return {ok: false, shape, errors: r.error.issues.flatMap((i) => describe(i, data))};
  const p = r.data;
  const errors: ParseError[] = [];
  if (!p.sources && !p.claims && !p.script && !p.storyboard) errors.push({path: '(root)', message: 'has nothing to import: add at least one of "sources", "claims", "script" or "storyboard"'});
  const nSources = p.sources?.length ?? 0;
  p.claims?.forEach((c, i) => c.sources?.forEach((s, j) => {
    if (typeof s === 'number' && s >= nSources) errors.push({path: `claims[${i}].sources[${j}]`, message: `source number ${s} does not exist: this packet lists ${nSources} source${nSources === 1 ? '' : 's'} (numbered from 0)`});
    if (typeof s === 'string' && !ctx.existingSourceIds.includes(s)) errors.push({path: `claims[${i}].sources[${j}]`, message: `there is no source "${s}" in this episode's research`});
  }));
  const nSegments = p.script ? p.script.segments.length : ctx.existingScriptSegments;
  p.storyboard?.scenes.forEach((sc, i) => sc.segments.forEach((n, j) => {
    if (nSegments === null) errors.push({path: `storyboard.scenes[${i}].segments[${j}]`, message: 'refers to a script segment, but there is no script yet: include "script" in the same packet or accept a script first'});
    else if (n > nSegments) errors.push({path: `storyboard.scenes[${i}].segments[${j}]`, message: `segment number ${n} does not exist: the script has ${nSegments} segment${nSegments === 1 ? '' : 's'} (numbered from 1)`});
  }));
  p.storyboard?.scenes.forEach((sc, i) => {
    if (sc.params === undefined) return;
    const at = `storyboard.scenes[${i}].params`;
    if (!SCENE_TYPE_IDS.includes(sc.sceneType)) { errors.push({path: at, message: `parameters can only be given for a scene type this app has (${SCENE_TYPE_IDS.join(', ')}); "${sc.sceneType}" is not one`}); return; }
    const r = SceneSchemaV2.safeParse({id: 'check', type: sc.sceneType, segments: ['s1'], params: sc.params});
    if (!r.success) for (const issue of r.error.issues) if (issue.path[0] === 'params') for (const e of describe(issue, {params: sc.params})) errors.push({path: `storyboard.scenes[${i}].${e.path}`, message: e.message});
  });
  if (errors.length) return {ok: false, shape, errors};
  const notes: string[] = [];
  return {
    ok: true,
    proposal: {
      shape, notes,
      sources: (p.sources ?? []).map((s) => ({title: s.title, url: s.url?.trim() ? s.url.trim() : null, publisher: s.publisher?.trim() ?? '', published: s.published ?? '', note: s.note?.trim() ?? ''})),
      claims: (p.claims ?? []).map((c) => ({text: c.text, kind: c.kind, sources: c.sources ?? [], evidence: c.evidence?.trim() ?? '', caveat: c.caveat?.trim() ?? ''})),
      script: p.script ? p.script.segments.map((s) => ({text: s.text, ...(s.speech?.trim() ? {speech: s.speech.trim()} : {}), ...(s.pauseAfter !== undefined ? {pauseAfter: s.pauseAfter} : {})})) : null,
      storyboard: p.storyboard ? p.storyboard.scenes.map((s) => ({segments: s.segments, sceneType: s.sceneType, intention: s.intention?.trim() ?? '', mechanism: s.mechanism?.trim() ?? '', pip: s.pip ?? [], ...(s.params ? {params: s.params} : {})})) : null,
    },
  };
}
// ---- a plain script ----------------------------------------------------------------------------------------------------------------
const ABBREVIATION = /(?:\b(?:e\.g|i\.e|vs|etc|Dr|Mr|Mrs|Ms|Prof|St|Inc|Ltd|No|approx|fig|cf)\.|\b[A-Z]\.)$/;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

function sentences(paragraph: string): string[] {
  const raw = paragraph.split(/(?<=[.!?…]["')\]”’]*)\s+(?=["'(\[“‘]*[A-Z0-9])/).map((s) => s.trim()).filter(Boolean);
  const merged: string[] = [];
  for (const s of raw) {
    if (merged.length && ABBREVIATION.test(merged[merged.length - 1])) merged[merged.length - 1] += ` ${s}`; else merged.push(s);
  }
  // a very short piece reads badly alone: join it to its neighbour
  const out: string[] = [];
  for (let i = 0; i < merged.length; i++) {
    const s = merged[i];
    if (words(s) < 3 && out.length) out[out.length - 1] += ` ${s}`;
    else if (words(s) < 3 && i + 1 < merged.length) merged[i + 1] = `${s} ${merged[i + 1]}`;
    else out.push(s);
  }
  return out;
}

/** Split a plain script into proposed segments: paragraphs first, then sentences. A heuristic the author always reviews. */
export function splitScript(raw: string): {segments: ProposedSegment[]; notes: string[]} {
  const notes: string[] = [];
  const paragraphs: string[][] = [[]];
  let labels = 0;
  const breakPara = () => { if (paragraphs[paragraphs.length - 1].length) paragraphs.push([]); };
  for (const line0 of raw.replace(/\r\n?/g, '\n').split('\n')) {
    let line = line0.trim();
    if (!line) { breakPara(); continue; }
    if (/^#{1,6}\s/.test(line)) { notes.push(`Left out the heading "${line.replace(/^#+\s*/, '').slice(0, 60)}" (not narration)`); breakPara(); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { breakPara(); continue; }
    if (/^[[(].*[\])]$/.test(line)) { notes.push(`Left out the direction "${line.slice(0, 60)}" (not narration)`); continue; }
    line = line.replace(/^([-*+]|\d+[.)])\s+/, '');
    const label = /^(narrator|voice-?over|vo|host|pip)\s*:\s*/i.exec(line);
    if (label) { line = line.slice(label[0].length); labels++; }
    line = line.replace(/(\*\*|__)(.+?)\1/g, '$2').trim();
    if (line) paragraphs[paragraphs.length - 1].push(line);
  }
  if (labels) notes.push(`Removed ${labels} speaker label${labels === 1 ? '' : 's'}`);
  const segments: ProposedSegment[] = [];
  paragraphs.filter((p) => p.length).forEach((p, para) => {
    for (const s of sentences(p.join(' '))) {
      const n = words(s);
      segments.push({text: s, para, ...(n > 40 ? {flags: ['long' as const]} : n < 4 ? {flags: ['short' as const]} : {})});
    }
  });
  return {segments, notes};
}

function fromScript(text: string): ParseResult {
  const {segments, notes} = splitScript(text);
  if (!segments.length) return {ok: false, shape: 'script', errors: [{path: '(script)', message: 'has no sentences to narrate once headings and directions are left out'}]};
  if (segments.length > MAX_SEGMENTS) return {ok: false, shape: 'script', errors: [{path: '(script)', message: `splits into ${segments.length} segments; this version takes at most ${MAX_SEGMENTS}`}]};
  const paras = new Set(segments.map((s) => s.para)).size;
  return {ok: true, proposal: {shape: 'script', sources: [], claims: [], script: segments, storyboard: null, notes: [`Split into ${segments.length} segment${segments.length === 1 ? '' : 's'} from ${paras} paragraph${paras === 1 ? '' : 's'}. This is a guess at the sentence boundaries: check every line before accepting.`, ...notes]}};
}

// ---- adjusting proposed segments before they are accepted --------------------------------------------------------------------
export const mergeUp = (rows: ProposedSegment[], i: number): ProposedSegment[] => (i <= 0 || i >= rows.length ? rows : [...rows.slice(0, i - 1), {...rows[i - 1], text: `${rows[i - 1].text} ${rows[i].text}`.replace(/\s+/g, ' ').trim(), flags: undefined}, ...rows.slice(i + 1)]);
export function splitAt(rows: ProposedSegment[], i: number, pos: number): ProposedSegment[] {
  const t = rows[i]?.text;
  if (t === undefined) return rows;
  const a = t.slice(0, pos).trim();
  const b = t.slice(pos).trim();
  if (!a || !b) return rows;
  return [...rows.slice(0, i), {...rows[i], text: a, flags: undefined}, {text: b, para: rows[i].para}, ...rows.slice(i + 1)];
}
export const removeRow = (rows: ProposedSegment[], i: number): ProposedSegment[] => rows.filter((_, k) => k !== i);
export const addRowAfter = (rows: ProposedSegment[], i: number): ProposedSegment[] => [...rows.slice(0, i + 1), {text: '', para: rows[i]?.para}, ...rows.slice(i + 1)];
export const setRowText = (rows: ProposedSegment[], i: number, text: string): ProposedSegment[] => rows.map((r, k) => (k === i ? {...r, text, flags: undefined} : r));
