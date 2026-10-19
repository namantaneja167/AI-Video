// The briefs the author copies into ChatGPT, in their own browser. The app only writes text here: it never contacts any
// service, and what comes back is pasted or opened by hand. Pure.
import {PACKET_VERSION} from './packet.ts';
import {CLAIM_LABEL, type PlanDoc} from './plan.ts';
import {SCENE_TYPES} from './storyboard.ts';

export type BriefKind = 'research' | 'script' | 'storyboard';
export const BRIEF_LABEL: Record<BriefKind, string> = {research: 'Research', script: 'Script', storyboard: 'Storyboard'};
export const WORDS_PER_MINUTE = 150;

const line = (label: string, v: string) => `${label}: ${v.trim() || '(not decided yet)'}`;

function episodeBlock(p: PlanDoc): string {
  const words = p.durationMin ? ` (roughly ${Math.round(p.durationMin * WORDS_PER_MINUTE)} words of narration)` : '';
  return [
    'THE EPISODE',
    line('Title', p.title),
    line('Audience', p.audience),
    line('What the viewer should understand by the end', p.objective),
    line('Target length', p.durationMin ? `about ${p.durationMin} minute${p.durationMin === 1 ? '' : 's'}${words}` : ''),
    ...(p.notes.trim() ? [`Notes from me: ${p.notes.trim()}`] : []),
  ].join('\n');
}

const HOW_TO_ANSWER = (example: string, rules: string[]) => `HOW TO ANSWER
Reply with ONE JSON object in a single \`\`\`json code block. My tool checks it strictly and rejects anything with an unknown field, so use only the fields shown. You may write comments outside the block; they are kept as plain text and are never acted on.

\`\`\`json
${example}
\`\`\`

RULES
${rules.map((r) => `- ${r}`).join('\n')}`;

export function briefFor(kind: BriefKind, p: PlanDoc, segments: {id: string; text: string}[] = []): string {
  const head = `I am planning one short explainer video, narrated by a friendly mascot called Pip. I will take your answer back into my own tool by hand, so answer exactly in the format below.\n\n${episodeBlock(p)}`;
  if (kind === 'research') {
    const known = p.sources.length ? `\n\nSOURCES I ALREADY HAVE (do not repeat them)\n${p.sources.map((s) => `- ${s.title}${s.url ? ` <${s.url}>` : ''}`).join('\n')}` : '';
    return `${head}${known}

WHAT I NEED
Research for this episode: the sources worth reading, and the specific claims the narration could make, each marked as a fact, an assumption or a proposed wording, with the evidence and the caveat.

${HOW_TO_ANSWER(`{
  "studioPacket": ${PACKET_VERSION},
  "kind": "research",
  "sources": [
    {"title": "Name of the page, paper or book", "url": "https://example.org/page", "publisher": "Who published it", "published": "2024-05-14", "note": "What it covers and why it matters"}
  ],
  "claims": [
    {"text": "One statement the narration could make", "kind": "fact", "sources": [0], "evidence": "What in the source supports it", "caveat": "What limits it or what to watch for"}
  ]
}`, [
      '"kind" must be exactly "fact", "assumption" or "proposed-wording". A fact needs at least one source; an assumption or a proposed wording does not.',
      '"sources" in a claim are positions in your own "sources" list, counting from 0.',
      'Only list a source you are confident exists. Never invent a link: if you do not know the address, leave "url" out. Leave "published" out when you do not know the date (use YYYY, YYYY-MM or YYYY-MM-DD).',
      'If you are unsure about a claim, say so in "caveat" instead of stating it confidently. I will check every source myself.',
      'Links must start with http:// or https://. Plain text only: no markdown inside the values.',
    ])}`;
  }
  if (kind === 'script') {
    const claims = p.claims.length ? `\n\nCLAIMS I HAVE SETTLED ON (stay within them)\n${p.claims.map((c) => `- [${CLAIM_LABEL[c.kind]}] ${c.text}${c.caveat ? ` (caveat: ${c.caveat})` : ''}`).join('\n')}` : '';
    return `${head}${claims}

WHAT I NEED
The narration, as short spoken lines Pip can say. One idea per line; each line one or two sentences, ideally under 25 words; plain spoken words with no markdown, stage directions or emoji.

${HOW_TO_ANSWER(`{
  "studioPacket": ${PACKET_VERSION},
  "kind": "script",
  "script": {
    "segments": [
      {"text": "The line as it should appear in the captions."},
      {"text": "A line with an ID like ABC-1234.", "speech": "A line with an I D like A B C, one two three four.", "pauseAfter": 0.4}
    ]
  }
}`, [
      '"speech" is optional: give it only when the spoken form must differ from the caption (symbols, IDs, acronyms). Otherwise leave it out.',
      '"pauseAfter" is optional, in seconds (0 to 5), for a deliberate beat only.',
      'If you cannot produce JSON, reply with the plain script instead: one paragraph per idea, one sentence per line is fine. I will split it and check it by hand.',
      'Do not add claims beyond the ones listed above without saying so outside the code block.',
    ])}`;
  }
  const numbered = segments.length ? segments.map((s, i) => `${i + 1}. ${s.text}`).join('\n') : '(there is no accepted script yet: accept a script first, then ask for the storyboard)';
  const types = SCENE_TYPES.map((t) => `- "${t.id}": ${t.label}${t.pip ? '' : ' (dark legacy look: do not use in a Pip episode)'}. ${t.summary}.`).join('\n');
  return `${head}

THE NARRATION (numbered from 1)
${numbered}

SCENE TYPES THAT EXIST
${types}

WHAT I NEED
A storyboard: the narration grouped, in order, into scenes. For each scene: which scene type, what the viewer should understand or feel (intention), what is shown and how it changes (mechanism), notes on what Pip does, and, for "pip-cards", its parameters.

${HOW_TO_ANSWER(`{
  "studioPacket": ${PACKET_VERSION},
  "kind": "storyboard",
  "storyboard": {
    "scenes": [
      {"segments": [1, 2], "sceneType": "pip-cards", "intention": "What the viewer should take from this scene", "mechanism": "What appears on screen and what changes", "pip": ["Pip looks at the first card"], "params": {"title": "Optional title", "cards": [{"heading": "Short heading", "body": "One short sentence."}, {"heading": "Second card", "body": "Another short sentence.", "at": {"segment": 1, "word": "a word spoken in line 2 of this scene"}}], "actions": [{"do": "point", "card": 0, "at": {"segment": 0, "edge": "start"}}, {"do": "nod", "at": {"segment": 1, "edge": "end"}}]}}
    ]
  }
}`, [
      '"segments" are the narration numbers above. Every line belongs to exactly one scene, and scenes follow the order of the narration.',
      '"sceneType" must be one of the ids above. If nothing there fits, use "custom" and describe what is needed in "mechanism". Do not pretend a scene type exists that is not listed.',
      'For "pip-cards", "params" holds 1 to 4 cards (heading up to 36 characters, body up to 110) and optional "actions" (do: point, look, nod, hop or smile; point and look need a "card", counted from 0). "at" names a line of the scene counted from 0 and either "edge": "start" or "end", or a "word" spoken in that line. Only the listed actions move Pip.',
      'The "pip" and "mechanism" text are planning notes: they do not animate anything by themselves. Describe what is planned; I check and apply the scenes by hand.',
    ])}`;
}
