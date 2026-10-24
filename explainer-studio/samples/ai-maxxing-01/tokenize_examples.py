"""Runs the displayed examples through a real tokenizer and writes tokenizer-evidence.json.

Run from explainer-studio/: .venv-qwen/bin/python samples/ai-maxxing-01/tokenize_examples.py
Uses only files already in the local Hugging Face cache; nothing is downloaded or installed.
"""
import glob, hashlib, json, os, sys
from transformers import AutoTokenizer
import tokenizers, transformers

REPO = 'models--mlx-community--Qwen3-TTS-12Hz-1.7B-Base-bf16'
snap = glob.glob(os.path.expanduser(f'~/.cache/huggingface/hub/{REPO}/snapshots/*/'))[0]
files = ['vocab.json', 'merges.txt', 'tokenizer_config.json']
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
tok = AutoTokenizer.from_pretrained(snap)

def encode(text):
    ids = tok.encode(text, add_special_tokens=False)
    assert tok.decode(ids) == text, 'the ids must decode back to the exact text'
    return ids

def pieces_of(text):
    # Each id decoded on its own; for plain English text this spells the text exactly.
    ids = encode(text)
    pieces = [tok.decode([i]) for i in ids]
    assert ''.join(pieces) == text, 'pieces must spell the text'
    return ids, pieces

main = 'Remind me to recharge my Jio plan tomorrow'
ids, pieces = pieces_of(main)
en = 'Wake me at six tomorrow morning'
hi = 'मुझे कल सुबह छह बजे उठाना'
en_ids, hi_ids = encode(en), encode(hi)

out = {
    'purpose': 'Evidence for AI Maxxing 01 (tokens). Every split, id and count shown in the video comes from this file.',
    'tokenizer': {
        'name': 'Qwen3-TTS text tokenizer',
        'class': type(tok).__name__,
        'algorithm': 'byte-level BPE (Qwen2Tokenizer)',
        'vocabularySize': len(tok),
        'model': 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16',
        'revision': os.path.basename(snap.rstrip('/')),
        'files': {f: sha(os.path.join(snap, f)) for f in files},
        'libraries': {'transformers': transformers.__version__, 'tokenizers': tokenizers.__version__},
        'addSpecialTokens': False,
        'note': 'One tokenizer of one model family. Other models split the same text differently, and token ids belong to one tokenizer only.',
    },
    'example': {'text': main, 'words': len(main.split()), 'tokens': len(ids), 'pieces': pieces, 'ids': ids},
    'languageComparison': {
        'english': {'text': en, 'words': len(en.split()), 'tokens': len(en_ids)},
        'hindi': {'text': hi, 'words': len(hi.split()), 'tokens': len(hi_ids),
                  'note': 'Pieces are not displayed: for Devanagari this tokenizer often splits inside a character, at byte level.'},
        'meaning': 'Wake me at six tomorrow morning (English) / the same request written in Hindi.',
    },
}
dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tokenizer-evidence.json')
with open(dest, 'w', encoding='utf-8') as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
print(json.dumps({'tokens': len(ids), 'pieces': pieces, 'en': len(en_ids), 'hi': len(hi_ids)}, ensure_ascii=False))
