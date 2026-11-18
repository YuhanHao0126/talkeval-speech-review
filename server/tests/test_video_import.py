import io
from pathlib import Path
import cv2
import numpy as np
import pytest
from flask import Flask
from local_sessions import create_local_sessions
from video_import import parse_subtitles

SRT='1\n00:00:00,200 --> 00:00:01,200\n先采集视频，再分析动作。\n\n2\n00:00:02,000 --> 00:00:03,000\n反馈帮助下一轮改进。\n'

def test_timestamped_subtitles():
    rows=parse_subtitles(SRT,4)
    assert len(rows)==2 and rows[0]['time_span']==[.2,1.2]
    assert rows[0]['source']=='imported-subtitle'
    assert parse_subtitles('WEBVTT\n\n00:00.100 --> 00:01.500 align:start\n实际说的话\n',3)[0]['at']==1.5
    assert parse_subtitles('',3)==[]
    for invalid in ['这是没有时间戳的讲稿',SRT.replace('03,000','09,000'),SRT.replace('01,200','00,100')]:
        with pytest.raises(ValueError):parse_subtitles(invalid,4)

def test_import_update_replay_delete(tmp_path):
    path=tmp_path/'input.mp4';writer=cv2.VideoWriter(str(path),cv2.VideoWriter_fourcc(*'mp4v'),20,(64,64))
    for i in range(80):writer.write(np.full((64,64,3),i,np.uint8))
    writer.release();video=path.read_bytes()
    root=tmp_path/'sessions';app=Flask(__name__);app.register_blueprint(create_local_sessions(root));c=app.test_client()
    key={'X-Session-Key':'a'*64};base='/api/sessions/import-test'
    def data():return {'video':(io.BytesIO(video),'my.mp4'),'topic':'我的复盘','outline':'采集视频，分析动作\n反馈帮助改进','subtitle':(io.BytesIO(SRT.encode()),'speech.srt')}
    assert c.post(base+'/import',data=data()).status_code==403
    result=c.post(base+'/import',headers=key,data=data());assert result.status_code==201,result.json
    saved=result.json['session'];assert saved['durationSeconds']==4 and len(saved['segments'])==2
    assert saved['cloudVideoReady'] and not saved['publicCloud'] and saved['sourceType']=='imported_video'
    assert c.get(base+'/video',headers={'Range':'bytes=0-30'}).data==video[:31]
    assert c.post(base+'/import',headers=key,data=data()).status_code==409
    assert c.put(base+'/review-materials',json={'outline':'新重点','subtitle':''}).status_code==403
    updated=c.put(base+'/review-materials',headers=key,json={'outline':'新重点','subtitle':''})
    assert updated.status_code==200 and updated.json['session']['segments']==[]
    assert len(c.get('/api/sessions').json['sessions'])==1
    # Whole-record updates cannot accidentally erase the imported media flag.
    assert c.put(base,headers=key,json={'id':'import-test','videoChunks':0}).status_code==400
    assert c.get(base).json['session']['cloudVideoReady']
    assert c.delete(base,headers=key).status_code==200
    assert c.get(base+'/video').status_code==404

def test_bad_import_is_not_listed(tmp_path):
    app=Flask(__name__);app.register_blueprint(create_local_sessions(tmp_path));c=app.test_client()
    response=c.post('/api/sessions/import-bad/import',headers={'X-Session-Key':'b'*64},data={'video':(io.BytesIO(b'broken'),'bad.mp4')})
    assert response.status_code==400
    assert c.get('/api/sessions').json['sessions']==[]
    assert not (tmp_path/'import-bad/upload.mp4').exists()
