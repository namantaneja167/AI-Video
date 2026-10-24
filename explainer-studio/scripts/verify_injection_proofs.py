"""Measurements for the injection presentation proofs (all by ffmpeg/ffprobe/numpy; nothing here is a viewing or listening judgement).

usage: .venv/bin/python scripts/verify_injection_proofs.py <proofsDir> <stillsDir> <mix.wav> <published.mp4> <out.json>
  proofsDir   baseline.mp4 interface.mp4 investigation.mp4 mechanism.mp4 (a second copy of each as <name>.run2.mp4 is optional)
  stillsDir   output of scripts/verify_injection_proofs_stills.ts
"""
import json, re, subprocess, sys, hashlib, os, tempfile
import numpy as np

proofs, stills, mix, published, out = sys.argv[1:6]
NAMES = ['baseline', 'interface', 'investigation', 'mechanism']
FPS = 30
st = json.load(open(f'{stills}/stills.json'))
FROM, TO = st['window']['from'], st['window']['to']
F0 = round(FROM * FPS)


def run(args, text=True):
    return subprocess.run(args, capture_output=True, text=text)


def psnr(a, b, filt=''):
    r = run(['ffmpeg', '-hide_banner', '-nostdin', '-i', a, '-i', b, '-lavfi', f'{filt}psnr', '-f', 'null', '-'])
    m = re.search(r'average:(\S+) min:(\S+) max:(\S+)', r.stderr)
    return {'average': float(m.group(1)) if m else None, 'min': float(m.group(2)) if m else None}


def crop_psnr(a, b, region):
    x, y, w, h = region
    r = run(['ffmpeg', '-hide_banner', '-nostdin', '-i', a, '-i', b, '-lavfi', f'[0:v]crop={w}:{h}:{x}:{y}[a];[1:v]crop={w}:{h}:{x}:{y}[b];[a][b]psnr', '-f', 'null', '-'])
    m = re.search(r'average:(\S+) min:(\S+) max:(\S+)', r.stderr)
    return {'average': float(m.group(1)) if m else None, 'min': float(m.group(2)) if m else None}


def pcm(args):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', *args, '-ac', '1', '-ar', '24000', '-f', 'f32le', '-'], capture_output=True)
    return np.frombuffer(r.stdout, dtype=np.float32).astype(np.float64)


res = {'window': {'from': FROM, 'to': TO, 'frames': st['frames'], 'firstFrame': F0}, 'tools': run(['ffmpeg', '-version']).stdout.splitlines()[0]}

# ---- file facts and a clean decode ----
files = {}
for n in NAMES:
    p = f'{proofs}/{n}.mp4'
    pr = json.loads(run(['ffprobe', '-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_frames,duration,sample_rate,channels', '-show_entries', 'format=duration,size', '-of', 'json', p]).stdout)
    v = next(s for s in pr['streams'] if s['codec_type'] == 'video'); a = next(s for s in pr['streams'] if s['codec_type'] == 'audio')
    dec = run(['ffmpeg', '-v', 'error', '-nostdin', '-i', p, '-f', 'null', '-'])
    loud = run(['ffmpeg', '-hide_banner', '-nostdin', '-i', p, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'])
    lufs = re.findall(r'I:\s+(-?[\d.]+) LUFS', loud.stderr); tp = re.findall(r'Peak:\s+(-?[\d.]+) dBFS', loud.stderr)
    files[n] = {'sha256': hashlib.sha256(open(p, 'rb').read()).hexdigest(), 'bytes': int(pr['format']['size']), 'durationSec': float(pr['format']['duration']),
                'video': {'codec': v['codec_name'], 'size': f"{v['width']}x{v['height']}", 'fps': v['r_frame_rate'], 'frames': int(v['nb_read_frames'])},
                'audio': {'codec': a['codec_name'], 'sampleRate': a['sample_rate'], 'channels': a['channels']},
                'decodeErrors': dec.stderr.strip() or None, 'integratedLufs': float(lufs[-1]) if lufs else None, 'truePeakDbfs': float(tp[-1]) if tp else None}
res['files'] = files

# ---- determinism across independent jobs ----
res['byteIdenticalAcrossJobs'] = {n: (hashlib.sha256(open(f'{proofs}/{n}.run2.mp4', 'rb').read()).hexdigest() == files[n]['sha256']) for n in NAMES if os.path.exists(f'{proofs}/{n}.run2.mp4')}

# ---- video frames against stills rendered by Remotion (a different path to the same frame) ----
tmp = tempfile.mkdtemp()
cmp = {}
for n in NAMES:
    vals = []
    for f in st[n]['sha256'].keys():
        idx = int(f) - F0
        fr = f'{tmp}/{n}-{idx}.png'
        run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', f'{proofs}/{n}.mp4', '-vf', f'select=eq(n\\,{idx})', '-vframes', '1', fr])
        vals.append(psnr(fr, f'{stills}/{n}/ascending/{f}.png')['average'])
    cmp[n] = {'frames': len(vals), 'meanPsnrDb': round(float(np.mean(vals)), 2), 'minPsnrDb': round(float(np.min(vals)), 2), 'firstAndLastFrame': [round(vals[0], 2), round(vals[-1], 2)]}
res['videoVsRemotionStill'] = cmp

# ---- seeking inside the file: a seek lands on exactly the same pixels as sequential decoding (PSNR of two decoded images is inf) ----
seek = {}
for n in NAMES:
    ok = 0; picks = [3, 77, 150, 211, 303, 397]
    for idx in picks:
        sk, sq = f'{tmp}/seek-{n}-{idx}.png', f'{tmp}/seq-{n}-{idx}.png'
        run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-ss', f'{idx / FPS - 0.004:.4f}', '-i', f'{proofs}/{n}.mp4', '-frames:v', '1', sk])
        run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', f'{proofs}/{n}.mp4', '-vf', f'select=eq(n\\,{idx})', '-vframes', '1', sq])
        r = run(['ffmpeg', '-hide_banner', '-nostdin', '-i', sk, '-i', sq, '-lavfi', 'psnr', '-f', 'null', '-'])
        ok += int('average:inf' in r.stderr)
    seek[n] = f'{ok}/{len(picks)} seeked frames equal the sequentially decoded frame'
res['seekInFile'] = seek

# ---- audio reuse: the narration comes from the recorded mix, byte-for-byte the same stream in every proof ----
md5 = {n: run(['ffmpeg', '-v', 'error', '-nostdin', '-i', f'{proofs}/{n}.mp4', '-vn', '-c', 'copy', '-f', 'md5', '-']).stdout.strip() for n in NAMES}
ref = pcm(['-ss', str(FROM), '-t', str(TO - FROM), '-i', mix])
aud = {}
for n in NAMES:
    got = pcm(['-i', f'{proofs}/{n}.mp4', '-vn'])
    m = min(len(ref), len(got)); a, b = ref[:m], got[:m]
    # lag by FFT cross-correlation within +-100 ms
    fa, fb = np.fft.rfft(a, 2 * m), np.fft.rfft(b, 2 * m); cc = np.fft.irfft(fa * np.conj(fb))
    lags = list(range(-2400, 2401)); best = max(lags, key=lambda L: cc[L % (2 * m)])
    sh = lambda x, L: (x[L:], np.zeros(0)) if L >= 0 else (x, np.zeros(0))
    a2, b2 = (a[best:], b[:m - best]) if best >= 0 else (a[:m + best], b[-best:])
    ncc = float(np.dot(a2, b2) / (np.linalg.norm(a2) * np.linalg.norm(b2) + 1e-12))
    resid = 10 * np.log10(np.sum((a2 - b2) ** 2) / (np.sum(a2 ** 2) + 1e-12) + 1e-12)
    aud[n] = {'bestLagMs': round(best / 24, 1), 'normalisedCorrelation': round(ncc, 5), 'residualVsMixDb': round(float(resid), 1), 'seconds': round(len(got) / 24000, 3)}
res['audio'] = {'decodedAudioStreamMd5': md5, 'allFourAudioStreamsIdentical': len(set(md5.values())) == 1, 'vsRecordedMixWindow': aud,
                'mixWindowLufs': (lambda s: float(re.findall(r'I:\s+(-?[\d.]+) LUFS', s)[-1]))(run(['ffmpeg', '-hide_banner', '-nostdin', '-ss', str(FROM), '-t', str(TO - FROM), '-i', mix, '-af', 'ebur128', '-f', 'null', '-']).stderr)}

# ---- branding and captions stay in screen coordinates: those bands are the same in every treatment ----
bands = {'header y=80..230 (banner, hook, series)': (60, 80, 960, 150), 'caption band y=1530..1680': (60, 1530, 960, 150), 'fictional note y=1740..1800': (60, 1740, 960, 60)}
res['bandsComparedWithBaseline'] = {n: {k: crop_psnr(f'{proofs}/{n}.mp4', f'{proofs}/baseline.mp4', v) for k, v in bands.items()} for n in NAMES[1:]}

# ---- older presentation default: the baseline proof against the same seconds of the published video (a full render made before these changes) ----
pub = f'{tempfile.mkdtemp()}/pub.mp4'
run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-ss', str(FROM), '-t', f'{TO - FROM:.3f}', '-i', published, '-an', '-c:v', 'libx264', '-crf', '0', '-preset', 'ultrafast', pub])
res['baselineVsPublishedSameSeconds'] = psnr(f'{proofs}/baseline.mp4', pub)

json.dump(res, open(out, 'w'), indent=1)
print(json.dumps({k: res[k] for k in ('byteIdenticalAcrossJobs', 'videoVsRemotionStill', 'seekInFile', 'baselineVsPublishedSameSeconds')}, indent=1))
print('audio', json.dumps({k: v for k, v in res['audio'].items() if k != 'decodedAudioStreamMd5'}, indent=1))
print('bands', json.dumps(res['bandsComparedWithBaseline'], indent=1))
