"""User-selected local recordings and timestamped subtitles for replay, not training."""
import json
import math
import re
import time
from pathlib import Path
import cv2
from flask import jsonify, request

MAX_VIDEO=1024*1024*1024
MAX_SUBTITLE=1024*1024

def parse_subtitles(text,duration):
    text=text.lstrip('\ufeff').replace('\r\n','\n').replace('\r','\n').strip()
    if not text:return []
    def seconds(value):
        parts=value.replace(',','.').split(':')
        if len(parts)==2:parts.insert(0,'0')
        h,m,s=map(float,parts)
        if not 0<=m<60 or not 0<=s<60:raise ValueError('字幕时间格式无效。')
        return h*3600+m*60+s
    pattern=r'((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3})(?:\s+.*)?'
    rows=[]
    for block in re.split(r'\n\s*\n',text):
        lines=block.splitlines()
        if lines[0].startswith(('WEBVTT','NOTE','STYLE','REGION')):continue
        index=next((i for i,line in enumerate(lines) if '-->' in line),None)
        if index is None:raise ValueError('请提供带时间戳的SRT或VTT字幕，普通讲稿不能代替实际转写。')
        match=re.fullmatch(pattern,lines[index].strip())
        if not match:raise ValueError('字幕时间应类似 00:00:02,000 --> 00:00:05,000。')
        start,end=map(seconds,match.groups())
        words=re.sub(r'<[^>]*>','', ' '.join(lines[index+1:])).strip()
        if not words or len(words)>4000:raise ValueError('字幕条目为空或过长，请检查文件。')
        if start<0 or end<=start or end>duration+.5:raise ValueError('字幕时间超出视频范围或结束时间早于开始时间，请检查是否选错字幕。')
        rows.append(dict(text=words,at=end,time_span=[start,end],source='imported-subtitle',timingQuality='provided-subtitle',asrConfidence=1))
    if not rows or len(rows)>10000:raise ValueError('未读到有效字幕，或字幕超过10000条。')
    return sorted(rows,key=lambda row:(row['time_span'][1],row['time_span'][0]))

def materials(outline,subtitle,duration):
    if len(outline)>16000 or len(subtitle.encode('utf-8'))>MAX_SUBTITLE:raise ValueError('提纲或字幕过大。')
    lines=[line.strip() for line in outline.splitlines() if line.strip()]
    if len(lines)>30 or any(len(line)>500 for line in lines):raise ValueError('最多30条重点，每条不超过500字。')
    points=[dict(id='import-point-'+str(i+1),text=line,claims=[line],evidence=[]) for i,line in enumerate(lines)]
    return points,parse_subtitles(subtitle,duration)

def register_video_import(bp,folder,authorize,load,lock):
    @bp.post('/api/sessions/<identifier>/import')
    def import_video(identifier):
        request.max_content_length=MAX_VIDEO+2*MAX_SUBTITLE
        temporary=None
        try:
            directory=folder(identifier)
            with lock:
                if not authorize(directory,create=True):return jsonify(error='缺少本场管理密钥。'),403
                if load(directory) or any(directory.glob('video.*')):return jsonify(error='该录像已经导入，请直接打开复盘。'),409
            uploaded=request.files.get('video')
            suffix=Path(uploaded.filename or '').suffix.lower() if uploaded else ''
            if suffix not in {'.mp4','.webm'}:raise ValueError('请选择MP4或WebM视频。其他格式请先导出为H.264编码的MP4。')
            temporary=directory/('upload'+suffix)
            size=0
            with temporary.open('wb') as target:
                while block:=uploaded.stream.read(1024*1024):
                    size+=len(block)
                    if size>MAX_VIDEO:raise ValueError('单个视频不能超过1GB。')
                    target.write(block)
            capture=cv2.VideoCapture(str(temporary))
            try:
                ok,_=capture.read();fps=capture.get(cv2.CAP_PROP_FPS);frames=capture.get(cv2.CAP_PROP_FRAME_COUNT)
                duration=frames/fps if fps>0 else 0
            finally:capture.release()
            if not ok or not math.isfinite(duration) or not 0<duration<=7200:raise ValueError('无法读取视频，或时长超过2小时。请导出为H.264编码的MP4后再试。')
            subtitle=request.files.get('subtitle');subtitle_text=''
            if subtitle:
                raw=subtitle.read(MAX_SUBTITLE+1)
                if len(raw)>MAX_SUBTITLE:raise ValueError('字幕不能超过1MB。')
                try:subtitle_text=raw.decode('utf-8-sig')
                except UnicodeDecodeError:raise ValueError('字幕请保存为UTF-8编码的SRT或VTT文件。')
            outline=request.form.get('outline','');points,segments=materials(outline,subtitle_text,duration)
            topic=request.form.get('topic','').strip()[:100] or Path(uploaded.filename).stem[:100]
            now=int(time.time()*1000)
            data=dict(id=identifier,topic=topic,speakerId=request.form.get('speaker','').strip()[:48] or '我的视频',language='zh',
                startedAt=now-duration*1000,endedAt=now,importedAt=now,durationSeconds=duration,sourceType='imported_video',
                points=points,segments=segments,audio=[],visual=[],timeline=[],slides=[],contextFits=[],metrics={},
                videoFile='video'+suffix,videoMimeType='video/mp4' if suffix=='.mp4' else 'video/webm',videoChunks=0,
                videoSaved=False,cloudStored=True,cloudVideoReady=True,storageScope='local_server',publicCloud=False,
                reviewMaterials=dict(outline=outline,subtitle=subtitle_text),
                report='用户导入录像。动作分析随播放运行；观点核对只使用已播放到的时间字幕。未提供字幕时，不判断实际讲了哪些内容。')
            with lock:
                temporary.replace(directory/data['videoFile']);temporary=None
                (directory/'session.json').write_text(json.dumps(data,ensure_ascii=False),'utf-8')
            return jsonify(session=data),201
        except (ValueError,TypeError) as error:return jsonify(error=str(error)),400
        finally:
            if temporary is not None:temporary.unlink(missing_ok=True)

    @bp.put('/api/sessions/<identifier>/review-materials')
    def update_materials(identifier):
        try:
            with lock:
                directory=folder(identifier)
                if not authorize(directory):return jsonify(error='只能在导入录像的浏览器中修改其复盘资料。'),403
                data=load(directory)
                if not data or data.get('sourceType')!='imported_video':return jsonify(error='不是导入的录像。'),404
                payload=request.get_json(silent=True) or {}
                outline=payload.get('outline','');subtitle=payload.get('subtitle','')
                points,segments=materials(outline,subtitle,data['durationSeconds'])
                data.update(points=points,segments=segments,reviewMaterials=dict(outline=outline,subtitle=subtitle))
                (directory/'session.json').write_text(json.dumps(data,ensure_ascii=False),'utf-8')
                return jsonify(session=data)
        except (ValueError,TypeError,AttributeError) as error:return jsonify(error=str(error)),400
