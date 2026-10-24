"""Builds the planning packets and the sample episode document for AI Maxxing 01 from tokenizer-evidence.json.

Run from explainer-studio/: python3 samples/ai-maxxing-01/make_packets.py
Nothing is fetched or run beyond reading the evidence file; the narration, claims and scene notes are authored here.
"""
import json, os
here = os.path.dirname(os.path.abspath(__file__))
ev = json.load(open(os.path.join(here, 'tokenizer-evidence.json'), encoding='utf-8'))
tk, ex, cmp_ = ev['tokenizer'], ev['example'], ev['languageComparison']

HOOK = "AI doesn't read one word at a time"
TITLE = "Tokens: why AI doesn't read one word at a time"
SCRIPT = [
    "You type: Remind me to recharge my Jio plan tomorrow. Eight words.",
    "But AI doesn't read eight words. A tokenizer cuts text into pieces called tokens.",
    "Here, one tokenizer splits Remind into Rem and ind. Jio becomes J and io.",
    "Then every piece becomes an ID number. The model works with those numbers.",
    "So the count is tokens, not words. Eight words became ten tokens.",
    "Language matters. With this tokenizer, an English alarm request is six tokens. In Hindi: twenty-three.",
    "Another model could split it differently.",
    "So before pasting a long prompt, check its tokens with your model's tokenizer.",
    "AI reads tokens, not words. Count tokens.",
]
assert ex['text'].lower().startswith('remind me to recharge my jio plan tomorrow')
assert ex['tokens'] == 10 and cmp_['english']['tokens'] == 6 and cmp_['hindi']['tokens'] == 23, 'the script quotes these counts'

SOURCES = [
    {"title": "OpenAI Help Center: Understanding and counting tokens", "url": "https://help.openai.com/en/articles/4936856-understanding-and-counting-tokens",
     "publisher": "OpenAI", "published": "",
     "note": "Primary source for what a token is, that counts differ by model, encoding and language, that token IDs depend on the encoding, the Tokenizer tool, and that the context window limits tokens. Read 2026-10-20 (page shows a relative 'Updated' date only)."},
    {"title": "tiktoken README (OpenAI)", "url": "https://github.com/openai/tiktoken", "publisher": "OpenAI",
     "published": "", "note": "Primary source for 'language models see sequences of numbers (tokens)' and how byte pair encoding turns text into tokens. Read 2026-10-20."},
    {"title": "Hugging Face Transformers: Tokenization algorithms", "url": "https://huggingface.co/docs/transformers/tokenizer_summary", "publisher": "Hugging Face",
     "published": "", "note": "Documentation of BPE, byte-level BPE, Unigram and WordPiece; lists Qwen2 among BPE models. Read 2026-10-20."},
    {"title": "Neural Machine Translation of Rare Words with Subword Units (Sennrich, Haddow, Birch)", "url": "https://arxiv.org/abs/1508.07909", "publisher": "arXiv / ACL 2016",
     "published": "2016-06-10", "note": "Original paper applying byte pair encoding to subword units (arXiv v5 dated 2016-06-10; first submitted 2015-08-31). Used only for the idea of subword pieces."},
    {"title": "Tokenizer evidence for this episode (local run)", "url": None, "publisher": "Local file, this project",
     "published": "", "note": f"samples/ai-maxxing-01/tokenizer-evidence.json: {tk['name']} ({tk['class']}, {tk['vocabularySize']} entries), model {tk['model']} revision {tk['revision']}, run with transformers {tk['libraries']['transformers']} / tokenizers {tk['libraries']['tokenizers']}. Every split, id and count on screen comes from this run."},
    {"title": "OpenAI Tokenizer (web tool)", "url": "https://platform.openai.com/tokenizer", "publisher": "OpenAI",
     "published": "", "note": "Named as the tool for seeing how text is divided in source 1. Not opened or run by this work; recorded only as the example of a model provider's own tokenizer."},
]
CLAIMS = [
    {"text": "A token can be a character, part of a word, a whole word or punctuation, and spaces also affect how text is divided.", "kind": "fact", "sources": [0],
     "evidence": "OpenAI Help Center, Overview: 'A token can represent a character, part of a word, a whole word, or punctuation. Spaces also affect how text is divided into tokens.'", "caveat": "Stated for OpenAI models; the splits shown in the video come from a different tokenizer."},
    {"text": "A token count is not the same as a word count; the same text can give different counts depending on the model, its encoding and the language.", "kind": "fact", "sources": [0],
     "evidence": "OpenAI Help Center, Overview: 'A token count is not the same as a word count. The same text can produce different token counts depending on the model, its encoding, and the language.'", "caveat": ""},
    {"text": "Token IDs depend on the encoding; an example ID does not apply to every model.", "kind": "fact", "sources": [0],
     "evidence": "OpenAI Help Center: 'Token IDs also depend on the encoding. Do not assume that an example token ID applies to every model.'", "caveat": "The IDs on screen are labelled as belonging to the named tokenizer."},
    {"text": "Language models work on sequences of numbers (tokens); byte pair encoding converts text into tokens, can be reversed exactly, and lets the model see common subwords.", "kind": "fact", "sources": [1, 2],
     "evidence": "tiktoken README: 'Language models don't see text like you and I, instead they see a sequence of numbers (known as tokens)... It's reversible and lossless... It attempts to let the model see common subwords.' Hugging Face docs describe BPE and byte-level BPE.", "caveat": "Describes BPE tokenizers; other tokenizer designs (Unigram, WordPiece) cut text differently."},
    {"text": f"With the {tk['name']} ({tk['algorithm']}), the message '{ex['text']}' is {ex['words']} words and {ex['tokens']} tokens: {' | '.join(p.replace(' ', '·') for p in ex['pieces'])} (a dot marks a leading space).", "kind": "fact", "sources": [4],
     "evidence": "Measured: samples/ai-maxxing-01/tokenizer-evidence.json (decode of the ids reproduces the exact text).", "caveat": "One tokenizer of one model family. Another model will cut this text differently."},
    {"text": f"With the same tokenizer, 'Wake me at six tomorrow morning' is {cmp_['english']['tokens']} tokens and a Hindi version of the request is {cmp_['hindi']['tokens']} tokens.", "kind": "fact", "sources": [4],
     "evidence": "Measured: tokenizer-evidence.json, languageComparison.", "caveat": "One sentence pair on one tokenizer; not a general ratio. The Hindi wording was written for this episode and should be checked by a fluent reader before publishing."},
    {"text": "The context window limits the tokens a model can work with in a request; check your model's documentation for its limit.", "kind": "fact", "sources": [0],
     "evidence": "OpenAI Help Center, 'Stay within model limits'.", "caveat": "Limits differ between models."},
    {"text": "Before pasting a long prompt, check its token count with your model's tokenizer.", "kind": "proposed-wording", "sources": [0, 5],
     "evidence": "Practical takeaway drawn from the Help Center's 'Count tokens before sending a request' (Tokenizer tool, tiktoken).", "caveat": "Not every app exposes a tokenizer or token counter, and a plain-text count does not include everything in an API request."},
]
research = {"studioPacket": 1, "kind": "research", "sources": SOURCES, "claims": CLAIMS}
script = {"studioPacket": 1, "kind": "script", "script": {"segments": [{"text": t} for t in SCRIPT]}}

params = {
    "tokenizer": {"name": tk['name'], "note": "byte-level BPE; ids belong to this tokenizer"},
    "example": {"text": ex['text'], "pieces": ex['pieces'], "ids": ex['ids']},
    "comparison": {"english": {"text": cmp_['english']['text'], "tokens": cmp_['english']['tokens']},
                   "hindi": {"text": cmp_['hindi']['text'], "tokens": cmp_['hindi']['tokens']}},
}
storyboard = {"studioPacket": 1, "kind": "storyboard", "storyboard": {"scenes": [{
    "segments": list(range(1, 10)), "sceneType": "token-journey",
    "intention": "Show that an AI is given pieces and numbers, not words, and that the count depends on the text, the language and the tokenizer.",
    "mechanism": "One typed message becomes plain text in a card; on the word 'tokenizer' it separates, piece by piece, into chips (a dot marks a leading space). Remind and Jio are outlined where they break. Each chip gains its ID; the chips dim and the list of ids is what the model gets. Word and token counters sit side by side. An English and a Hindi request fill bars to their real token counts; a dashed row of question marks stands for another tokenizer without inventing its output; a paste, tokenizer, count, send strip closes the working diagram before the full-page takeaway.",
    "pip": ["Pip watches the message, tilts his head at the cut", "Pip points at Remind and at Jio as they break", "Pip is surprised at the Hindi count", "Pip nods at the check step"],
    "params": params}]}}

def seg(i, t): return {"id": f"s{i}", "text": t}
segs = [seg(i + 1, t) for i, t in enumerate(SCRIPT)]
episode = {
    "schemaVersion": 2, "id": "tokens-why-ai-doesnt-read-one-word-at-a-time", "title": TITLE,
    "learningObjective": "After one watch the viewer can say that an AI splits text into tokens, turns them into numbers, and that token counts differ from word counts and vary by model and language.",
    "status": "draft", "style": "pip-paper-bundled", "voice": {"engine": "qwen3-tts", "profile": "pip-voice-v1"},
    "pacing": {"leadInSec": 0.5, "tailSec": 1.6, "segmentGapSec": 0.2},
    "narration": {"segments": segs, "blocks": [{"id": "b1", "segments": ["s1", "s2", "s3"]}, {"id": "b2", "segments": ["s4", "s5"]}, {"id": "b3", "segments": ["s6", "s7"]}, {"id": "b4", "segments": ["s8", "s9"]}]},
    "scenes": [{"id": "token-world", "type": "token-journey", "segments": [s['id'] for s in segs], "params": params,
                "layout": {"template": "content-led", "captionZone": "bottom", "mascot": {"mode": "docked", "position": "bottom-left", "scale": 0.42}}, "openingHook": HOOK}],
    "sources": [{"title": s['title'], "url": s['url'], "note": s['note']} for s in SOURCES if s['url']],
    "beats": [], "chapters": [], "reviewNotes": [], "previews": {},
}
for name, doc in {'research-packet.json': research, 'script-packet.json': script, 'storyboard-packet.json': storyboard, 'episode.rough-preview.json': episode}.items():
    with open(os.path.join(here, name), 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False); f.write('\n')
words = sum(len(t.split()) for t in SCRIPT)
print('hook', len(HOOK), 'chars;', 'script words', words, ';', len(CLAIMS), 'claims;', len(SOURCES), 'sources')
