"""Original TalkEval site + local motion inference and presenter relay.

The original evidence engine is kept in original-site/. A replay forecast uses
only the selected recording's causal pose history, never its future frames.
"""
from pathlib import Path
from functools import lru_cache
import json
import math
import re
import secrets
import subprocess
import threading
import time

import numpy as np
from flask import Blueprint, jsonify, request, send_from_directory
from audio_envelope import AudioEnvelopeCache
from audio_features import AcousticCache

ROOT = Path(__file__).resolve().parent
SITE = ROOT / 'original-site'
DECKS = ROOT / 'data' / 'stage-decks'
DECKS.mkdir(parents=True, exist_ok=True)
PEOPLE = {
    'speech_001_ai_work': ('speaker_zhang_dandan', 'source-02.mp4'),
    'speech_002_pressure_white_hair': ('speaker_zhang_bing', 'source-01.mp4'),
    'speech_004_whales': ('speaker_chen_bingyao', 'source-04.mp4'),
    'speech_005_climate': ('speaker_zhang_shihui', 'source-03.mp4'),
}


def local_video(case_id):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,110}', case_id):
        return None
    if case_id.startswith('recording_'):
        directory = ROOT / 'data/stage-sessions' / case_id.removeprefix('recording_')
        if not (directory / 'session.json').is_file():
            return None
        return next((directory / name for name in ['video.mp4', 'video.webm'] if (directory / name).is_file()), None)
    if case_id in PEOPLE:
        path = ROOT / 'data/archive-20261030' / PEOPLE[case_id][1]
    elif case_id.startswith('speech_auto_') and (SITE / 'data/cases' / (case_id + '.json')).is_file():
        path = ROOT / 'data/expanded-20261105/recovered' / (case_id + '.mp4')
    else:
        return None
    return path if path.is_file() else None


def pose_records(case_id,extended=False):
    if case_id.startswith('recording_'):
        identifier=case_id.removeprefix('recording_')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,90}',identifier):return []
        directory=ROOT/'data/stage-sessions'/identifier
        manifest=directory/'pose-cache.json'
        if not manifest.is_file() or not (directory/'session.json').is_file():return []
        try:
            row=json.loads(manifest.read_text('utf-8'))
            if row.get('video_file') not in {'video.mp4','video.webm'}:return []
            video=directory/row['video_file'];stat=video.stat()
            if stat.st_size!=row['source_bytes'] or stat.st_mtime_ns!=row['source_mtime_ns']:return []
            if row.get('fps')!=20 or not (directory/'pose-cache.npz').is_file():return []
            return [dict(id=identifier,sequence_path='../stage-sessions/'+identifier+'/pose-cache.npz',source_start_seconds=0,frames=row['frames'],split='user_replay_not_training')]
        except (ValueError,KeyError,OSError):return []
    return public_pose_records(case_id,extended)


@lru_cache(maxsize=20)
def public_pose_records(case_id,extended=False):
    if not (SITE / 'data/cases' / (case_id + '.json')).is_file():
        return []
    manifest = ROOT / 'data/fine-20261105/speaker_manifest.json'
    if not manifest.is_file():
        return []
    person = PEOPLE.get(case_id, ('speaker_' + case_id,))[0]
    records=[r for r in json.loads(manifest.read_text('utf-8'))['recordings'] if r['speaker_id']==person]
    long_log=ROOT/'data/extended-10s-v1/preparation-log.json'
    if long_log.exists():
        long_records=[dict(r,sequence_path='../extended-10s-v1/'+r['sequence_path']) for r in json.loads(long_log.read_text('utf-8')) if r['speaker_id']==person and r['status'] in {'included','no_long_window'}]
        records=long_records+records if extended else records+long_records
    return records


@lru_cache(maxsize=12)
def pose_arrays(relative):
    path = (ROOT / 'data/fine-20261105' / relative).resolve()
    if not path.is_relative_to(ROOT / 'data'):
        raise ValueError('姿态路径无效。')
    with np.load(path, allow_pickle=False) as data:
        return {k: data[k] for k in data.files}


def causal_record(case_id, at, history_frames,extended=False):
    for record in pose_records(case_id,extended):
        offset = record['source_start_seconds']
        frame = math.floor((at - offset) * 20 + 1e-6)
        if frame < history_frames - 1 or frame >= record.get('frames',300):
            continue
        seq = pose_arrays(record['sequence_path'])
        start = frame - history_frames + 1
        if frame >= len(seq['positions']):
            continue
        if 'segment_ids' in seq and len(set(seq['segment_ids'][start:frame+1])) != 1:
            continue
        return record, seq, start, frame
    return None


@lru_cache(maxsize=1)
def trained_audio_model():
    from audio_motion import AudioPredictor
    return AudioPredictor(ROOT/'runs/audio-fusion-v15/forecast.pt')


def create_integration(windows):
    bp = Blueprint('integrated', __name__)
    audio_cache = AudioEnvelopeCache(ROOT / 'data/audio-envelope-v14')
    acoustic_cache = AcousticCache(ROOT / 'data/acoustic-cache-v15')
    relays = {}
    lock = threading.Lock()
    deck_lock = threading.Lock()
    deck_jobs = {}

    @bp.get('/site/')
    def site_index():
        return send_from_directory(SITE, 'index.html')

    @bp.get('/site/<path:filename>')
    def site_file(filename):
        return send_from_directory(SITE, filename)

    @bp.get('/site/data/cases/<case_id>.json')
    def site_case(case_id):
        path = SITE / 'data/cases' / (case_id + '.json')
        if not path.is_file():
            return jsonify(error='未找到该案例。'), 404
        data = json.loads(path.read_text('utf-8'))
        if local_video(case_id):
            data['video_url'] = '/stage-media/' + case_id
            data['video_format'] = 'mp4'
        return jsonify(data)

    @bp.get('/stage-media/<case_id>')
    def case_media(case_id):
        path = local_video(case_id)
        if path is None:
            return jsonify(error='未找到本机原始视频。'), 404
        return send_from_directory(path.parent, path.name, conditional=True)

    @bp.get('/presenter/')
    def presenter():
        return send_from_directory(ROOT / 'static', 'presenter.html')

    @bp.get('/api/stage/forecast')
    def recorded_forecast():
        try:
            case_id = request.args.get('case_id', '')
            at = float(request.args.get('at', '0'))
            if not math.isfinite(at) or not 0 <= at <= 14400:
                raise ValueError('播放时间无效。')
            model, h, f, profile = windows.resolve(request.args)
            selected = causal_record(case_id, at, h,profile=='extended')
            if selected is None:
                return jsonify(ready=False, cached=False, message='当前位置无完整姿态缓存，播放后从画面积累观察。')
            record, seq, start, frame = selected
            positions = seq['positions'][start:frame+1]
            quality = seq['visibility'][start:frame+1]
            if (quality[:, 1:7] >= .4).mean() < .35 or (quality[-1, 1:7] >= .4).mean() < .5:
                return jsonify(ready=False, cached=True, message='当前手臂观测不足，暂停动作预测。')
            began = time.perf_counter()
            anchor = record['source_start_seconds'] + frame / 20
            requested_method=request.args.get('method','adaptive')
            if requested_method not in {'adaptive','gru','audio','persistence'}:raise ValueError('预测模型选项无效。')
            method=requested_method
            audio_info=dict(audio_model_used=False,audio_model_status='off')
            future=None
            if requested_method=='audio':
                method='gru'
                if h not in [40,60,80] or f not in [10,20,30,40,60]:
                    audio_info.update(audio_model_status='unsupported',audio_model_note='声音模型支持观察2–4秒、预测0.5–3秒；当前使用姿态模型。')
                elif not (ROOT/'runs/audio-fusion-v15/forecast.pt').is_file():
                    audio_info.update(audio_model_status='unavailable',audio_model_note='声音模型权重尚未就绪；当前使用姿态模型。')
                else:
                    times=record['source_start_seconds']+np.arange(start,frame+1)/20
                    acoustic,note=acoustic_cache.get(local_video(case_id),times)
                    if acoustic is None:
                        audio_info.update(audio_model_status='loading' if note=='声学特征正在准备' else 'unavailable',audio_model_note=note+'；当前使用姿态模型。')
                    else:
                        future=trained_audio_model().predict(positions,quality,acoustic,horizon_frames=f)
                        method='audio'
                        audio_info.update(audio_model_used=True,audio_model_status='ready',audio_input_end=anchor,audio_feature_count=13,
                                          audio_model_note='训练版已使用历史声音的能量、频谱和音高特征。')
            if future is None:
                future=np.repeat(positions[-1:],f,axis=0) if method=='persistence' else model.predict(positions,quality,method,horizon_frames=f)
            return jsonify(ready=True, cached=True, source='同一录像姿态缓存 · 本机时序推理',
                case_id=case_id, at=anchor,method=method,requested_method=requested_method,**audio_info,
                exploratory=profile=='extended', history_start=record['source_start_seconds']+start/20,
                history=positions.round(5).tolist(), visibility=quality.round(3).tolist(),
                positions=future.round(5).tolist(), history_frames=h, horizon_frames=f,
                sampling_fps=20, history_seconds=h/20, horizon_seconds=f/20,
                target_at=round(anchor+f/20,6), future_offsets=[(i+1)/20 for i in range(f)],
                detail={'positions': seq['detailed_positions'][frame].round(5).tolist(),
                        'visibility': seq['detailed_visibility'][frame].round(3).tolist()},
                image_points=seq['detailed_image_points'][frame].round(5).tolist(),
                processing_ms=round((time.perf_counter()-began)*1000, 2), model_profile=profile,
                training_split=record['split'], future_ground_truth_used=False)
        except (ValueError, TypeError, KeyError) as error:
            return jsonify(error=str(error)), 400

    @bp.get('/api/stage/segments/<case_id>')
    def segments(case_id):
        return jsonify(segments=[{'start': r['source_start_seconds'], 'end': r['source_start_seconds']+(r.get('frames',300)-1)/20,
            'split': r['split']} for r in sorted(pose_records(case_id,True),key=lambda r:r['source_start_seconds'])])

    @bp.get('/api/stage/audio')
    def recorded_audio():
        try:
            at = float(request.args.get('at', '0'))
            history = float(request.args.get('history_seconds', '2'))
            if not math.isfinite(at) or not 0 <= at <= 14400 or not math.isfinite(history) or not .5 <= history <= 10:
                raise ValueError('音频时间窗无效。')
            response = jsonify(audio_cache.window(local_video(request.args.get('case_id', '')), at, history))
            response.headers['Cache-Control'] = 'no-store'
            return response
        except (ValueError, OSError) as error:
            return jsonify(error=str(error)), 400

    @bp.post('/api/stage/session')
    def new_relay():
        with lock:
            now = time.monotonic()
            for key in list(relays):
                if now - relays[key]['touched'] > 3600:
                    del relays[key]
            if len(relays) >= 32:
                return jsonify(error='提示会话已满，请稍后再试。'), 429
            read, write = secrets.token_hex(16), secrets.token_hex(16)
            relays[read] = {'write': write, 'state': None, 'touched': now, 'sequence': 0}
        return jsonify(read_token=read, write_token=write, presenter_url='/presenter/?session='+read)

    @bp.route('/api/stage/session/<token>', methods=['GET', 'POST', 'DELETE'])
    def relay(token):
        with lock:
            item = relays.get(token)
            if not item:
                return jsonify(error='本场提示会话已结束，请从展示页重新打开。'), 404
            if request.method in {'POST', 'DELETE'}:
                if not secrets.compare_digest(request.headers.get('X-Stage-Key', ''), item['write']):
                    return jsonify(error='该视图只读。'), 403
                if request.method == 'DELETE':
                    del relays[token]
                    return jsonify(closed=True)
                if request.content_length is None or request.content_length > 250000:
                    return jsonify(error='提示状态过大。'), 413
                state = request.get_json(silent=True)
                if not isinstance(state, dict) or state.get('version') != 9:
                    return jsonify(error='提示状态格式无效。'), 400
                item.update(state=state, touched=time.monotonic(), sequence=item['sequence']+1)
            response = jsonify(state=item['state'], sequence=item['sequence'],
                               age_seconds=round(time.monotonic()-item['touched'], 2))
            response.headers['Cache-Control'] = 'no-store'
            return response

    def convert_deck(identifier, path):
        try:
            out = DECKS / identifier
            with deck_lock:
                command = ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                    str(ROOT / 'tools/render_stage_ppt.ps1'), '-Source', str(path), '-Destination', str(out)]
                completed = subprocess.run(command, capture_output=True, timeout=150,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if completed.returncode or not list(out.glob('slide-*.png')):
                raise ValueError('PPT 转换失败。请确认已安装 PowerPoint，或从 PPT 导出 PNG 后导入。')
            pages = sorted(out.glob('slide-*.png'))
            deck_jobs[identifier] = {'status': 'done', 'pages': [f'/stage-decks/{identifier}/{p.name}' for p in pages]}
        except Exception as error:
            deck_jobs[identifier] = {'status': 'error', 'error': str(error)}

    @bp.post('/api/stage/deck')
    def upload_deck():
        from PIL import Image, ImageOps
        files = request.files.getlist('files')
        if not files or len(files) > 80:
            return jsonify(error='请选择一个 PPTX，或不超过80张页面图片。'), 400
        identifier = secrets.token_hex(16)
        folder = DECKS / identifier
        folder.mkdir()
        if len(files) == 1 and Path(files[0].filename or '').suffix.lower() == '.pptx':
            path = folder / 'source.pptx'
            files[0].save(path)
            deck_jobs[identifier] = {'status': 'running'}
            threading.Thread(target=convert_deck, args=(identifier, path), daemon=True).start()
            return jsonify(id=identifier, status='running'), 202
        try:
            pages = []
            for i, file in enumerate(files):
                if Path(file.filename or '').suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp'}:
                    raise ValueError('支持 PPTX 或 PNG、JPG、WebP 图片。')
                with Image.open(file.stream) as picture:
                    if picture.width * picture.height > 50000000:
                        raise ValueError('页面图片过大。')
                    picture = ImageOps.exif_transpose(picture).convert('RGB')
                    picture.thumbnail((1600, 1200))
                    name = f'slide-{i+1:03}.jpg'
                    picture.save(folder / name, quality=88)
                    pages.append(f'/stage-decks/{identifier}/{name}')
            deck_jobs[identifier] = {'status': 'done', 'pages': pages}
            return jsonify(id=identifier, **deck_jobs[identifier])
        except (ValueError, OSError) as error:
            return jsonify(error=str(error)), 400

    @bp.get('/api/stage/deck/<identifier>')
    def deck_status(identifier):
        return jsonify(deck_jobs.get(identifier, {'status': 'error', 'error': '未找到导入任务。'}))

    @bp.get('/stage-decks/<identifier>/<filename>')
    def deck_file(identifier, filename):
        if len(identifier) != 32 or any(c not in '0123456789abcdef' for c in identifier):
            return jsonify(error='页面编号无效。'), 404
        if not filename.startswith('slide-') or Path(filename).suffix not in {'.png', '.jpg'}:
            return jsonify(error='页面不存在。'), 404
        return send_from_directory(DECKS / identifier, filename)

    return bp
