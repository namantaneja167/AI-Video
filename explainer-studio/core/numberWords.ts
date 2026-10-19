// Numbers as spoken words, for the caption-versus-speech check. Same idea as the legacy `verify` (num2words, with hyphens, commas and
// "and" removed before comparing): a number is accepted when its standard reading or its year reading appears in the spoken text.
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

const below100 = (n: number): string => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''));
const below1000 = (n: number): string => (n < 100 ? below100(n) : `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${below100(n % 100)}` : ''}`);

/** English words for a non-negative whole number up to the trillions, without "and" or hyphens. */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e15) throw new RangeError(`cannot spell ${n}`);
  if (n === 0) return 'zero';
  const parts: string[] = [];
  for (let i = 0, rest = n; rest > 0; i++, rest = Math.floor(rest / 1000)) {
    const chunk = rest % 1000;
    if (chunk) parts.unshift(`${below1000(chunk)}${SCALES[i] ? ` ${SCALES[i]}` : ''}`);
  }
  return parts.join(' ');
}

/** How a year is said: 1999 "nineteen ninety nine", 2005 "two thousand five", 2020 "twenty twenty". */
export function yearToWords(n: number): string | null {
  if (!Number.isInteger(n) || n < 1100 || n > 2099) return null;
  if (n % 1000 === 0) return numberToWords(n);
  if (n >= 2000 && n < 2010) return `two thousand ${ONES[n - 2000]}`;
  const hi = Math.floor(n / 100), lo = n % 100;
  return lo === 0 ? `${below100(hi)} hundred` : lo < 10 ? `${below100(hi)} oh ${ONES[lo]}` : `${below100(hi)} ${below100(lo)}`;
}

/** Lower case, hyphens and punctuation gone, one space between words, and "and" removed (so "two hundred and one" equals "two hundred one"). */
export const normalizeSpoken = (s: string): string =>
  ` ${s.toLowerCase().replace(/[-‐–—]/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()} `.replace(/ and /g, ' ').replace(/\s+/g, ' ');

/** The readings a caption number may be spoken as (normalised). */
export function spokenForms(n: number): string[] {
  const forms = [numberToWords(n)];
  const y = yearToWords(n);
  if (y) forms.push(y);
  return forms.map((f) => normalizeSpoken(f).trim());
}

/** True when the normalised spoken text contains one of the readings as whole words, not as the start or end of a longer number. */
const NUMBER_WORDS = new Set([...ONES, ...TENS.filter(Boolean), 'hundred', ...SCALES.filter(Boolean)]);
export const speaks = (spoken: string, n: number): boolean => {
  const words = normalizeSpoken(spoken).trim().split(' ');
  return spokenForms(n).some((f) => {
    const want = f.split(' ');
    for (let i = 0; i + want.length <= words.length; i++) {
      if (want.some((w, k) => words[i + k] !== w)) continue;
      if (NUMBER_WORDS.has(words[i - 1] ?? '') || NUMBER_WORDS.has(words[i + want.length] ?? '')) continue;
      return true;
    }
    return false;
  });
};

const CURRENCY: Record<string, string[]> = {'₹': ['rupee', 'rupees'], $: ['dollar', 'dollars'], '€': ['euro', 'euros'], '£': ['pound', 'pounds']};

export type CaptionNumber = {raw: string; value: number | null; decimals: string | null; currency: string | null; percent: boolean};

/** Numbers written in digits in a caption, with a currency symbol before them or a percent sign after them. */
export function captionNumbers(text: string): CaptionNumber[] {
  const out: CaptionNumber[] = [];
  for (const m of text.matchAll(/([₹$€£])?\s?(\d[\d,]*)(?:\.(\d+))?\s?(%)?/g)) {
    const digits = m[2].replace(/,/g, '');
    const value = /^\d+$/.test(digits) ? Number(digits) : null;
    out.push({raw: m[0].trim(), value: value !== null && value < 1e15 ? value : null, decimals: m[3] ?? null, currency: m[1] ?? null, percent: m[4] === '%'});
  }
  return out;
}

/** What is missing from the spoken text for this caption number, or null when it is spoken correctly. */
export function missingSpoken(spoken: string, n: CaptionNumber): string | null {
  if (n.value === null) return `${n.raw}: too large or not a plain number to check`;
  if (!speaks(spoken, n.value)) return `${n.raw}: the spoken text does not say "${numberToWords(n.value)}"`;
  const hay = ` ${normalizeSpoken(spoken).trim()} `;
  if (n.decimals !== null) {
    const d = [...n.decimals].map((c) => ONES[Number(c)]).join(' ');
    if (!hay.includes(` point ${d} `)) return `${n.raw}: the spoken text does not say "point ${d}"`;
  }
  if (n.currency && !CURRENCY[n.currency].some((w) => hay.includes(` ${w} `))) return `${n.raw}: the spoken text does not name the currency ("${CURRENCY[n.currency][1]}")`;
  if (n.percent && !hay.includes(' percent ') && !hay.includes(' per cent ')) return `${n.raw}: the spoken text does not say "percent"`;
  return null;
}
