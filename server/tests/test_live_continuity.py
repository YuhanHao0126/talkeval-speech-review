import numpy as np
import live


class FakeTracker:
    def __init__(self):self.resets=0;self.visible=True
    def reset(self):self.resets+=1
    def close(self):pass
    def process(self,frame,timestamp):
        points=np.ones((33,3),np.float32)
        quality=np.ones(33,np.float32) if self.visible else np.zeros(33,np.float32)
        return points,quality,np.zeros((33,2),np.float32)


class Predictor:
    def __init__(self):self.calls=0
    def predict(self,positions,quality,method,horizon_frames):
        self.calls+=1
        return np.repeat(positions[-1:],horizon_frames,axis=0)


def test_600ms_frames_accumulate_instead_of_resetting(monkeypatch):
    monkeypatch.setattr(live,'FinePose',FakeTracker)
    session=live.LiveSession();predictor=Predictor()
    outputs=[session.process(None,n*600,predictor,'gru',history_frames=40,horizon_frames=60) for n in range(12)]
    assert outputs[0]['observed_ready'] and not outputs[0]['ready']
    assert outputs[0]['observation']['current']
    assert sum(out['ready'] for out in outputs)==8
    assert session.tracker.resets==0
    assert outputs[-1]['target_at']==outputs[-1]['at']+3


def test_missing_observation_never_becomes_a_new_prediction(monkeypatch):
    monkeypatch.setattr(live,'FinePose',FakeTracker)
    session=live.LiveSession();predictor=Predictor()
    for n in range(25):session.process(None,n*100,predictor,'gru',history_frames=40,horizon_frames=60)
    before=predictor.calls;session.tracker.visible=False
    missing=session.process(None,2500,predictor,'gru',history_frames=40,horizon_frames=60)
    assert not missing['ready'] and not missing['observed_ready'] and missing['observation'] is None
    assert predictor.calls==before
    session.tracker.visible=True
    result=session.process(None,5000,predictor,'gru',history_frames=40,horizon_frames=60)
    assert result['observed_ready'] and not result['ready']
    assert session.tracker.resets==1


def test_long_unobserved_gaps_remain_low_confidence():
    rows=[(t,np.full((9,3),t,np.float32),np.ones(9,np.float32)) for t in [0,1,2]]
    _,quality,times=live.resample_history(rows,40)
    for index,t in enumerate(times):
        if min(abs(t-value) for value in [0,1,2])<1e-6:assert quality[index].min()==1
        else:assert quality[index].max()==0
