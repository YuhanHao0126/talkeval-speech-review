"""Long windows must contain real past time and must not read unseen poses."""
import numpy as np
import pytest


def test_long_api_is_causal_and_uses_200_steps(monkeypatch):
    from app import app
    import integration
    c=app.test_client()
    params=dict(case_id='speech_auto_c2c143e546',at=788.075,model_profile='extended',history_seconds=10,horizon_seconds=10,method='gru')
    first=c.get('/api/stage/forecast',query_string=params).json
    assert first['ready'] and first['model_profile']=='extended'
    assert len(first['history'])==len(first['positions'])==200
    assert first['at']-first['history_start']==pytest.approx(9.95)
    assert first['target_at']-first['at']==pytest.approx(10)
    assert first['future_offsets'][0]==.05 and first['future_offsets'][-1]==10
    assert first['future_ground_truth_used'] is False
    record,_,_,frame=integration.causal_record(params['case_id'],params['at'],200,True)
    loader=integration.pose_arrays
    def poison(path):
        data={k:v.copy() for k,v in loader(path).items()}
        if path==record['sequence_path']:
            data['positions'][frame+1:]=999
            data['visibility'][frame+1:]=0
            data['detailed_positions'][frame+1:]=-999
        return data
    monkeypatch.setattr(integration,'pose_arrays',poison)
    second=c.get('/api/stage/forecast',query_string=params).json
    np.testing.assert_array_equal(first['positions'],second['positions'])
    for key in ['history_seconds','horizon_seconds']:
        assert c.get('/api/stage/forecast',query_string={**params,key:11}).status_code==400
    assert c.get('/api/stage/forecast',query_string={**params,'model_profile':'flexible'}).status_code==400


def test_live_buffer_retains_ten_real_seconds(monkeypatch):
    import live
    class Tracker:
        def reset(self):pass
        def process(self,frame,ms):
            return np.full((33,3),ms/1000,dtype=np.float32),np.ones(33,dtype=np.float32),np.zeros((33,3))
        def close(self):pass
    class Model:
        def predict(self,p,v,method,horizon_frames):
            self.history=p
            return np.repeat(p[-1:],horizon_frames,axis=0)
    monkeypatch.setattr(live,'FinePose',Tracker)
    session=live.LiveSession();model=Model()
    for ms in range(0,15001,250):
        result=session.process(None,ms,model,'gru',history_frames=200,horizon_frames=200)
        if ms<10000:assert not result['ready']
    assert result['ready'] and result['capture_fps']==4
    assert result['timestamps'][0]==pytest.approx(5.05)
    assert result['timestamps'][-1]==15 and result['target_at']==25
    assert len(result['positions'])==200 and result['method']=='gru'
    np.testing.assert_allclose(model.history[:,0,0],result['timestamps'],atol=1e-6)
    assert len(session.rows)<=44
    # v19 retains history across a brief capture delay but never promotes the
    # missing interval's interpolated poses to reliable observations.
    delayed=session.process(None,16000,model,'gru',history_frames=200,horizon_frames=200)
    assert delayed['ready'] and delayed['target_at']==26
    times=np.asarray(delayed['timestamps']);quality=np.asarray(delayed['visibility'])
    assert quality[(times>15)&(times<16)].max()==0
    assert quality[-1].min()==1
    reset=session.process(None,18001,model,'gru',history_frames=200,horizon_frames=200)
    assert not reset['ready'] and reset['observed_ready'] and reset['tracking_state']=='warming'


def test_checkpoint_and_window_support():
    from app import windows
    from dataset import file_digest
    from motion import ROOT
    assert file_digest(ROOT/'runs/long-fine-v4/forecast.pt')=='17a163403634dc102d52dd1d37c5ce971fc00239f2a55226c9acdf050dd9a175'
    for h in range(2,11):
        for f in [.5,1,1.5,*range(2,11)]:
            model,history,future,profile=windows.resolve(dict(model_profile='extended',history_seconds=h,horizon_seconds=f))
            result=model.predict(np.zeros((history,9,3),np.float32),np.ones((history,9),np.float32),'gru',horizon_frames=future)
            assert result.shape==(future,9,3) and np.isfinite(result).all()
            assert windows.selected_report(history,future,profile)['metrics']['gru']['windows']==18
