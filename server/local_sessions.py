"""Compatibility storage for the original site's explicitly saved recordings.

This is a localhost service, not public cloud publishing. Management keys never
appear in public session responses. Original browser-local recording remains.
"""
import json
import re
import secrets
import threading
from pathlib import Path
from flask import Blueprint, jsonify, request, send_from_directory
from video_import import register_video_import


def create_local_sessions(root):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    bp = Blueprint('local_sessions', __name__)
    lock = threading.RLock()

    def folder(identifier):
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,90}', identifier):
            raise ValueError('记录编号无效。')
        return root / identifier

    def authorize(directory, create=False):
        key = request.headers.get('X-Session-Key', '')
        if not re.fullmatch(r'[a-f0-9]{32,128}', key):
            return False
        path = directory / 'owner.key'
        if not path.exists():
            if not create:
                return False
            directory.mkdir(exist_ok=True)
            path.write_text(key, encoding='ascii')
        return secrets.compare_digest(path.read_text('ascii'), key)

    def load(directory):
        path = directory / 'session.json'
        return json.loads(path.read_text('utf-8')) if path.is_file() else None

    @bp.get('/api/sessions')
    def sessions():
        with lock:
            rows = [load(p) for p in root.iterdir() if p.is_dir()]
        return jsonify(sessions=[r for r in rows if r], storage='local_server', public_cloud=False)

    @bp.route('/api/sessions/<identifier>', methods=['GET', 'PUT', 'DELETE'])
    def session(identifier):
        try:
            with lock:
                directory = folder(identifier)
                if request.method == 'GET':
                    value = load(directory)
                    return (jsonify(session=value) if value else (jsonify(error='记录不存在。'), 404))
                if not authorize(directory, create=request.method == 'PUT'):
                    return jsonify(error='缺少本场管理密钥。'), 403
                if request.method == 'DELETE':
                    # Delete only known files inside this validated session directory.
                    for p in directory.iterdir():
                        if p.is_file() and (p.name in {'session.json', 'owner.key', 'video.webm', 'video.mp4', 'upload.mp4', 'upload.webm','pose-cache.json','pose-cache.npz'} or re.fullmatch(r'chunk-\d{6}\.webm', p.name)):
                            p.unlink()
                    return jsonify(deleted=True, id=identifier)
                data = request.get_json(silent=True)
                if not isinstance(data, dict) or data.get('id') != identifier:
                    return jsonify(error='记录格式无效。'), 400
                chunks = int(data.get('videoChunks') or 0)
                if not 0 <= chunks <= 10000:
                    raise ValueError('录像分段数量无效。')
                parts = [directory / f'chunk-{i:06}.webm' for i in range(chunks)]
                stored=load(directory)
                if stored and stored.get('sourceType')=='imported_video':
                    return jsonify(error='导入录像请使用“补充提纲 / 字幕”更新资料。'),400
                ready = bool(parts) and all(p.is_file() for p in parts)
                if ready:
                    with (directory / 'video.webm').open('wb') as output:
                        for path in parts:
                            with path.open('rb') as source:
                                while block := source.read(1024*1024):
                                    output.write(block)
                data.update(cloudStored=True, cloudVideoReady=ready, storageScope='local_server', publicCloud=False)
                (directory / 'session.json').write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
                return jsonify(session=data)
        except (ValueError, TypeError) as error:
            return jsonify(error=str(error)), 400

    @bp.put('/api/sessions/<identifier>/chunks/<int:index>')
    def chunk(identifier, index):
        try:
            with lock:
                directory = folder(identifier)
                if not 0 <= index < 10000:
                    raise ValueError('录像分段编号无效。')
                if not authorize(directory, create=True):
                    return jsonify(error='缺少本场管理密钥。'), 403
                (directory / f'chunk-{index:06}.webm').write_bytes(request.get_data())
                return jsonify(saved=True, index=index)
        except ValueError as error:
            return jsonify(error=str(error)), 400

    @bp.get('/api/sessions/<identifier>/video')
    def video(identifier):
        try:
            directory=folder(identifier);data=load(directory) or {}
            filename=data.get('videoFile','video.webm')
            if filename not in {'video.mp4','video.webm'}:return jsonify(error='录像路径无效。'),400
            return send_from_directory(directory, filename, conditional=True)
        except ValueError as error:
            return jsonify(error=str(error)), 400

    @bp.route('/api/sessions/<identifier>/analysis', methods=['GET', 'POST'])
    def analysis(identifier):
        try:data=load(folder(identifier)) or {}
        except ValueError as error:return jsonify(error=str(error)),400
        if data.get('sourceType')=='imported_video':
            return jsonify(status='unavailable',message='已使用导入的时间字幕，按播放进度核对。' if data.get('segments') else '未提供字幕：可以复盘动作；核对内容请点击“补充提纲 / 字幕”。本机尚未接入自动音轨转写。',segments=[])
        return jsonify(status='unavailable', message='本机整合版沿用录制时保存的转写；离线音轨补转写服务尚未接入。', segments=[])

    register_video_import(bp,folder,authorize,load,lock)
    return bp
