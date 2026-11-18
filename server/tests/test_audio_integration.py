import numpy as np
from flask import Flask
from audio_features import align_features


def test_replay_audio_is_causal_and_fallback_is_explicit(tmp_path,monkeypatch):
    import integration
    weights=tmp_path/'runs/audio-fusion-v15/forecast.pt'
    weights.parent.mkdir(parents=True);weights.write_bytes(b'test marker')
    monkeypatch.setattr(integration,'ROOT',tmp_path)
    p=np.zeros((200,9,3),np.float32);v=np.ones((200,9),np.float32)
    seq=dict(positions=p,visibility=v,detailed_positions=np.zeros((200,33,3)),
             detailed_visibility=np.ones((200,33)),detailed_image_points=np.zeros((200,33,3)))
    def record(case,at,h,extended=False):
        frame=int(np.floor((at-10)*20+1e-6))
        return dict(source_start_seconds=10,split='test'),seq,frame-h+1,frame
    monkeypatch.setattr(integration,'causal_record',record)
    monkeypatch.setattr(integration,'local_video',lambda case:tmp_path/'video.mp4')
    features=np.ones((500,13),np.float32);features[:,0]=np.arange(500)/500
    seen=[]
    def acoustic(self,path,times):
        seen.append(times.copy());return align_features(features,times),'ready'
    monkeypatch.setattr(integration.AcousticCache,'get',acoustic)
    class Trained:
        def predict(self,p,v,a,horizon_frames):
            return np.repeat(p[-1:],horizon_frames,axis=0)+a[:,0].mean()/10
    monkeypatch.setattr(integration,'trained_audio_model',lambda:Trained())
    class Pose:
        def predict(self,p,v,method,horizon_frames):return np.repeat(p[-1:],horizon_frames,axis=0)
    class Windows:
        def resolve(self,args):return Pose(),int(float(args.get('history_seconds',2))*20),int(float(args.get('horizon_seconds',2))*20),'flexible'
    app=Flask(__name__);app.register_blueprint(integration.create_integration(Windows()));client=app.test_client()
    params=dict(case_id='example',at=16.33,method='audio')
    first=client.get('/api/stage/forecast',query_string=params).json
    assert first['audio_model_used'] and first['method']=='audio'
    assert first['audio_input_end']==first['at']==16.3
    assert seen[0].max()==16.3 and len(seen[0])==40
    # All blocks ending after the cutoff are poisoned; prediction must not change.
    features[326:]=999;p[127:]=999
    second=client.get('/api/stage/forecast',query_string=params).json
    assert first['positions']==second['positions']
    monkeypatch.setattr(integration.AcousticCache,'get',lambda *args:(None,'声学特征正在准备'))
    loading=client.get('/api/stage/forecast',query_string=params).json
    assert not loading['audio_model_used'] and loading['audio_model_status']=='loading' and loading['method']=='gru'
    unsupported=client.get('/api/stage/forecast',query_string={**params,'horizon_seconds':4}).json
    assert unsupported['audio_model_status']=='unsupported' and unsupported['method']=='gru'
    baseline=client.get('/api/stage/forecast',query_string={**params,'method':'persistence'}).json
    np.testing.assert_array_equal(baseline['positions'],np.repeat(p[126:127],40,axis=0))
