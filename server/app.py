from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path

import numpy as np
import torch
from flask import Flask, jsonify, request, send_from_directory, redirect
from werkzeug.exceptions import HTTPException

from motion import HISTORY, HORIZON, ROOT, Predictor, errors, extract_video, forecast_sequence, load_sequence, to_payload, validate_history
from alignment import align_claims
from live import LiveSession
from window_config import WindowRegistry
from functools import lru_cache
from fine_pose import extract_fine_video
from integration import create_integration
from local_sessions import create_local_sessions

torch.set_num_threads(4)
app = Flask(__name__, static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024
predictor = Predictor()
windows = WindowRegistry(predictor)
app.register_blueprint(create_integration(windows))
app.register_blueprint(create_local_sessions(ROOT / 'data' / 'stage-sessions'))
jobs = {}
job_lock = threading.Lock()
analysis_lock = threading.Lock()
live_lock = threading.Lock()
live_sessions = {}
UPLOADS = ROOT / "data" / "uploads"
UPLOADS.mkdir(parents=True, exist_ok=True)


@app.get("/")
def index():
    return redirect('/site/?case=recording_import-poisson-20261106-demo&at=31.12' if (ROOT/'data/stage-sessions/import-poisson-20261106-demo/session.json').exists() else '/site/?case=speech_004_whales&at=789.216')


@app.get('/static/demo-poisson-20261106.html')
def legacy_recording_entry():
    return redirect('/site/?case=recording_import-poisson-20261106-demo&at=31.12&history=2&horizon=3&method=audio&display=trend&strength=4&audio=on')


@app.get('/lab/')
def laboratory():
    return app.send_static_file("index.html")


@app.get("/api/status")
def status():
    report_path = ROOT / "models" / "evaluation.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else None
    return jsonify({"model_ready": predictor.model is not None, "report": report, "history_seconds": 2, "horizon_seconds": 0.5, 'window_options':windows.options()})


def forecast_payload(sequence,settings):
    model,h,f,profile=windows.resolve(settings)
    forecasts={};timings={}
    for method in ['adaptive','gru','persistence','velocity']:
        if method in {'adaptive','gru'} and not model.model:continue
        forecasts[method],timings[method]=forecast_sequence(sequence,model,method,history_frames=h,horizon_frames=f)
    if not any(forecasts.values()):raise ValueError(f'视频缺少连续{(h+f)/20:g}秒的观察与复盘窗口；请缩短时长或换一段视频。')
    payload=to_payload(sequence,forecasts,history_frames=h,horizon_frames=f)
    payload.update(model_profile=profile,latency_ms=timings,report=windows.selected_report(h,f,profile))
    return payload


@lru_cache(maxsize=24)
def reforecast_source(source_id,h,f,profile):
    if source_id=='sample':
        original=json.loads((ROOT/'static/sample.json').read_text('utf-8'))
        path=ROOT/'data/archive-20261030'/original['source_recording']['sequence_path']
        # Preserve the complete selected pose sample in portable packages as well.
        if not path.exists():path=ROOT/'data/display-sample.npz'
        fine=ROOT/'data/fine-20261105/poses/speaker_chen_bingyao--source-04-block-08.npz'
        if profile=='flexible' and fine.exists():path=fine
        metadata={key:original[key] for key in ['title','source','video_url','training_split','preferred_anchor','source_recording','evaluation_scope'] if key in original}
        if profile=='flexible':metadata['title']='3秒预测与动作指引 · 留出演讲片段'
    else:
        if len(source_id)!=32 or any(c not in '0123456789abcdef' for c in source_id):raise ValueError('无效视频编号。')
        path=UPLOADS/f'{source_id}.npz';record=UPLOADS/f'{source_id}.json'
        if not path.exists() or not record.exists():raise ValueError('找不到该视频的姿态，请重新上传。')
        original=json.loads(record.read_text('utf-8'))
        metadata={key:original[key] for key in ['title','source','video_url','evaluation_scope'] if key in original}
    payload=forecast_payload(load_sequence(path),dict(history_seconds=h/20,horizon_seconds=f/20,model_profile=profile))
    payload.update(metadata,source_id=source_id)
    return payload


@app.get('/api/sample')
def sample():
    try:
        _,h,f,profile=windows.resolve(request.args)
        return jsonify(reforecast_source('sample',h,f,profile))
    except (ValueError,TypeError) as error:return jsonify(error=str(error)),400


@app.post('/api/reforecast')
def reforecast():
    try:
        payload=request.get_json()
        if not isinstance(payload,dict):raise ValueError('请求须为JSON对象。')
        _,h,f,profile=windows.resolve(payload)
        return jsonify(reforecast_source(str(payload.get('source_id','sample')),h,f,profile))
    except (ValueError,TypeError) as error:return jsonify(error=str(error)),400


@app.get('/api/window-report')
def window_report():
    try:
        _,h,f,profile=windows.resolve(request.args)
        selected=windows.selected_report(h,f,profile)
        if selected is None:selected=json.loads((ROOT/'models/evaluation.json').read_text('utf-8'))
        return jsonify(selected)
    except (ValueError,TypeError) as error:return jsonify(error=str(error)),400


def analyze(path, identifier, title, settings=None):
    with analysis_lock:
        try:
            with job_lock:
                jobs[identifier].update(status="running", progress=0)

            def progress(value):
                with job_lock:
                    jobs[identifier]["progress"] = round(value * 0.7, 3)

            sequence_path = UPLOADS / f"{identifier}.npz"
            extractor=extract_fine_video if (settings or {}).get('model_profile')=='flexible' else extract_video
            sequence = extractor(path, sequence_path, progress, detect_cuts=True)
            payload = forecast_payload(sequence, settings or {})
            payload.update(title=title, video_url=f"/media/{path.name}", source="用户上传视频", source_id=identifier, evaluation_scope="新上传片段；未用于本次权重训练。")
            output = UPLOADS / f"{identifier}.json"
            output.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
            with job_lock:
                jobs[identifier].update(status="done", progress=1, result_url=f"/api/result/{identifier}")
        except Exception as exception:
            with job_lock:
                jobs[identifier].update(status="error", error=str(exception))


@app.post("/api/analyze")
def upload():
    video = request.files.get("video")
    if video is None or not video.filename:
        return jsonify(error="请选择视频文件。"), 400
    suffix = Path(video.filename).suffix.lower()
    if suffix not in {".mp4", ".webm", ".mov", ".avi", ".mkv"}:
        return jsonify(error="支持MP4、WebM、MOV、AVI和MKV。"), 400
    settings=dict(request.form)
    try:windows.resolve(settings)
    except (ValueError,TypeError) as error:return jsonify(error=str(error)),400
    with job_lock:
        if any(job["status"] in {"queued", "running"} for job in jobs.values()):
            return jsonify(error="已有视频正在处理，请等候完成。"), 409
        identifier = uuid.uuid4().hex
        jobs[identifier] = {"status": "queued", "progress": 0}
    path = UPLOADS / f"{identifier}{suffix}"
    try:
        video.save(path)
    except Exception:
        with job_lock:
            jobs[identifier] = {"status": "error", "error": "视频保存失败。"}
        raise
    threading.Thread(target=analyze, args=(path, identifier, Path(video.filename).name, settings), daemon=True).start()
    return jsonify(job_id=identifier), 202


@app.get("/api/jobs/<identifier>")
def job_status(identifier):
    with job_lock:
        job = jobs.get(identifier)
        return (jsonify(dict(job)), 200) if job else (jsonify(error="任务不存在。"), 404)


@app.get("/api/result/<identifier>")
def result(identifier):
    if len(identifier) != 32 or any(character not in "0123456789abcdef" for character in identifier):
        return jsonify(error="无效结果编号。"), 400
    return send_from_directory(UPLOADS, f"{identifier}.json")


@app.get("/media/<filename>")
def media(filename):
    return send_from_directory(UPLOADS, filename, conditional=True)


@app.post("/api/forecast")
def forecast():
    try:
        payload = request.get_json()
        if not isinstance(payload, dict):
            raise ValueError("请求必须是JSON对象。")
        model,h,f,profile=windows.resolve(payload)
        positions, visibility = validate_history(payload.get("positions", []), payload.get("visibility", []),h)
        if float((visibility[:, 1:7] >= 0.4).mean()) < 0.2:
            raise ValueError("历史窗口有效姿态太少，暂不预测。")
        method = payload.get("method", "gru")
        started = time.perf_counter()
        prediction = model.predict(positions, visibility, method,horizon_frames=f)
        return jsonify(positions=prediction.tolist(), method=method, inference_ms=round((time.perf_counter() - started) * 1000, 3), history_seconds=h/20, horizon_seconds=f/20,model_profile=profile)
    except (ValueError, TypeError, KeyError) as exception:
        return jsonify(error=str(exception)), 400


@app.errorhandler(HTTPException)
def http_error(error):
    return jsonify(error="文件超过200 MB。" if error.code == 413 else error.description), error.code


@app.post('/api/alignment')
def alignment():
    try:
        payload=request.get_json()
        if not isinstance(payload,dict):raise ValueError('请求须为JSON对象。')
        return jsonify(align_claims(payload.get('outline'),payload.get('transcript')))
    except (ValueError,TypeError) as error:
        return jsonify(error=str(error)),400


@app.post('/api/live')
def live_start():
    with live_lock:
        for identifier, session in list(live_sessions.items()):
            if time.monotonic()-session.updated>120:
                session.close();del live_sessions[identifier]
        if len(live_sessions)>=3:return jsonify(error='已有3个摄像头会话，请先关闭其中一个。'),409
        identifier=uuid.uuid4().hex
        live_sessions[identifier]=LiveSession()
    return jsonify(id=identifier)


@app.route('/api/live/<identifier>',methods=['POST','DELETE'])
def live_frame(identifier):
    import cv2
    with live_lock:
        session=live_sessions.get(identifier)
        if not session:return jsonify(error='摄像头会话已结束，请重新开启。'),404
        if request.method=='DELETE':
            session.close();del live_sessions[identifier];return jsonify(closed=True)
        try:
            uploaded=request.files.get('frame')
            if uploaded is None:raise ValueError('缺少摄像头画面。')
            raw=uploaded.read(2*1024*1024+1)
            if len(raw)>2*1024*1024:raise ValueError('单帧图像超过2MB。')
            from PIL import Image
            import io
            with Image.open(io.BytesIO(raw)) as probe:
                if max(probe.size)>1920:raise ValueError('摄像头帧最长边不能超过1920像素。')
            frame=cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_COLOR)
            if frame is None:raise ValueError('无法解码摄像头画面。')
            model,h,f,profile=windows.resolve(request.form)
            result=session.process(frame,request.form.get('timestamp_ms'),model,request.form.get('method','adaptive'),history_frames=h,horizon_frames=f)
            result['model_profile']=profile
            return jsonify(result)
        except (ValueError,TypeError,OSError) as error:return jsonify(error=str(error)),400


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8765, debug=False, threaded=True)
