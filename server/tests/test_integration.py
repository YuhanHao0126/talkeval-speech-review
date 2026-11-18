import io
import numpy as np
import pytest
from PIL import Image
from flask import Flask
from integration import create_integration
from local_sessions import create_local_sessions


@pytest.fixture(scope='module')
def client():
    from app import app
    app.testing = True
    return app.test_client()


def test_original_site_and_same_recording(client):
    assert client.get('/').status_code == 302
    assert '双通道演讲提词器' in client.get('/site/').get_data(as_text=True)
    data = client.get('/site/data/cases/speech_004_whales.json').json
    assert data['video_url'] == '/stage-media/speech_004_whales'
    assert data['intent_map']['beats'] and data['expression_map']['units']
    media = client.get(data['video_url'], headers={'Range': 'bytes=0-99'})
    assert media.status_code == 206 and len(media.data) == 100


def test_forecast_reads_past_only(client, monkeypatch):
    import integration
    params = dict(case_id='speech_004_whales', at=789.216, model_profile='flexible', history_seconds=2, horizon_seconds=2)
    first = client.get('/api/stage/forecast', query_string=params).json
    assert first['ready'] and first['at'] <= params['at']
    assert len(first['history']) == 40 and len(first['positions']) == 40
    assert first['sampling_fps']==20 and first['horizon_seconds']==2
    assert first['target_at']==pytest.approx(first['at']+2)
    assert first['future_offsets'][0]==.05 and first['future_offsets'][-1]==2
    assert first['future_ground_truth_used'] is False
    loader = integration.pose_arrays
    def poisoned(path):
        data = {k: v.copy() for k, v in loader(path).items()}
        # 789.216 - 781.016 = 8.2s, frame164. Change every unseen pose.
        data['positions'][165:] = 999
        data['visibility'][165:] = 0
        data['detailed_positions'][165:] = -999
        return data
    monkeypatch.setattr(integration, 'pose_arrays', poisoned)
    second = client.get('/api/stage/forecast', query_string=params).json
    np.testing.assert_array_equal(first['positions'], second['positions'])
    assert client.get('/api/stage/forecast', query_string={**params, 'at': 780}).json['ready'] is False
    assert client.get('/api/stage/forecast', query_string={**params, 'case_id':'speech_003_college_students'}).json['ready'] is False
    assert client.get('/api/stage/forecast', query_string={**params, 'horizon_seconds': 9}).status_code == 400


def test_presenter_is_read_only_and_closes(client):
    relay = client.post('/api/stage/session').json
    url = '/api/stage/session/' + relay['read_token']
    state = {'version':9, 'caseId':'test', 'at':12, 'playing':False}
    assert client.post(url, json=state).status_code == 403
    assert client.post(url, json=state, headers={'X-Stage-Key':relay['write_token']}).status_code == 200
    assert client.get(url).json['state'] == state
    assert 'write_token' not in client.get(url).json
    assert client.delete(url, headers={'X-Stage-Key':relay['write_token']}).status_code == 200
    assert client.get(url).status_code == 404


def test_local_recording_save_load_authorization(tmp_path):
    app=Flask(__name__);app.register_blueprint(create_local_sessions(tmp_path));c=app.test_client()
    key='a'*64;headers={'X-Session-Key':key}
    assert c.put('/api/sessions/live-test/chunks/0',data=b'first',headers=headers).status_code==200
    assert c.put('/api/sessions/live-test/chunks/1',data=b'second',headers=headers).status_code==200
    data={'id':'live-test','videoChunks':2,'segments':[{'text':'已说过的话','at':1}]}
    assert c.put('/api/sessions/live-test',json=data).status_code==403
    saved=c.put('/api/sessions/live-test',json=data,headers=headers).json['session']
    assert saved['cloudVideoReady'] and not saved['publicCloud']
    assert c.get('/api/sessions/live-test/video').data==b'firstsecond'
    assert c.get('/api/sessions').json['sessions'][0]['segments']==data['segments']
    assert c.get('/api/sessions/live-test/analysis').json['status']=='unavailable'
    assert c.delete('/api/sessions/live-test',headers={'X-Session-Key':'b'*64}).status_code==403
    assert c.delete('/api/sessions/live-test',headers=headers).status_code==200
    assert not c.get('/api/sessions').json['sessions']
