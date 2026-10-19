// Friendly names for what the document and the project call things.
export const sceneTypeLabel = (t: string, id?: string): string => (id === 'storyboard-pending' ? 'Stand-in (scenes not made yet)' : (({'context-window': 'Context window explainer', 'pip-scene-10x': 'Pip scene', 'pip-dense-fixture': 'Dense layout test', 'kpi-mismatch': 'Dashboard mismatch', 'tables-lab': 'Tables lab', cards: 'Cards'} as Record<string, string>)[t] ?? t));
export const layoutLabel = (t: string): string => t.split('-').map((w, i) => (i ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
export const voiceLabel = (v: {engine: string; profile?: string; voice?: string}): string => (v.engine === 'qwen3-tts' ? `Pip voice (${v.profile})` : `${v.voice ?? 'Kokoro'} (Kokoro)`);
export const styleLabel = (s: string): string => ({'pip-paper-bundled': 'Pip, warm paper', 'pip-paper': 'Pip, warm paper (system font)', 'legacy-dark': 'Dark'} as Record<string, string>)[s] ?? s;
export const mmss = (sec: number): string => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, '0')}`;
export const when = (ms: number): string => new Date(ms).toLocaleString(undefined, {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'});
export const whenShort = (ms: number): string => new Date(ms).toLocaleString(undefined, {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
