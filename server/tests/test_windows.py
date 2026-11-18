import numpy as np
import pytest
import torch
from motion import ForecastGRU, Predictor, baseline_forecast
from dataset import sequence_anchors
from live import resample_history


def test_variable_checkpoint_direct_horizons_and_legacy_limits(tmp_path):
    model=ForecastGRU(horizon_frames=30)
    path=tmp_path/'flex.pt'
    torch.save({'state_dict':model.state_dict(),'horizon_frames':30,'metadata':{'history_options_frames':[40,60,80],'horizon_options_frames':[10,20,30]}},path)
    predictor=Predictor(path)
    for h in [40,60,80]:
        p=np.zeros((h,9,3),np.float32);v=np.ones((h,9),np.float32)
        full=predictor.predict(p,v,'gru',horizon_frames=30)
        np.testing.assert_array_equal(predictor.predict(p,v,'gru',horizon_frames=20),full[:20])
        assert predictor.predict(p,v,'persistence',horizon_frames=10).shape==(10,9,3)
    with pytest.raises(ValueError):predictor.predict(p[:50],v[:50],'gru',horizon_frames=20)
    with pytest.raises(ValueError):predictor.predict(p,v,'gru',horizon_frames=40)
    with pytest.raises(ValueError):Predictor(None).predict(p,v,'persistence',horizon_frames=30)


def test_long_windows_respect_clip_boundaries_and_camera_time():
    sequence={'positions':np.zeros((300,9,3)),'_split':'train','segment_ids':np.repeat([0,1],150)}
    anchors=sequence_anchors(sequence,'train',history_frames=80,horizon_frames=30)
    assert anchors
    assert all(a-79>=0 and a+30<300 and sequence['segment_ids'][a-79]==sequence['segment_ids'][a+30] for a in anchors)
    rows=[(i/10,np.full((9,3),i/10,np.float32),np.ones(9,np.float32)) for i in range(42)]
    for h in [40,60,80]:
        positions,quality,times=resample_history(rows,h)
        assert positions.shape==(h,9,3) and quality.shape==(h,9)
        assert times[-1]==4.1 and times[0]>=rows[0][0]
        np.testing.assert_allclose(positions[:,0,0],times,atol=1e-6)
    assert resample_history(rows[:25],60) is None


def test_flexible_api_window_shape_and_invalid_options():
    from app import app,windows
    assert windows.flexible is not None
    client=app.test_client()
    body=dict(model_profile='flexible',history_seconds=3,horizon_seconds=1.5,positions=np.zeros((60,9,3)).tolist(),visibility=np.ones((60,9)).tolist(),method='persistence')
    response=client.post('/api/forecast',json=body)
    assert response.status_code==200 and len(response.json['positions'])==30
    assert response.json['history_seconds']==3 and response.json['horizon_seconds']==1.5
    for changed in [dict(history_seconds=2),dict(horizon_seconds=4),dict(history_seconds='nan')]:
        assert client.post('/api/forecast',json=dict(body,**changed)).status_code==400
    sample=client.get('/api/sample?model_profile=flexible&history_seconds=4&horizon_seconds=1.5')
    assert sample.status_code==200
    assert sample.json['history_frames']==80 and sample.json['horizon_frames']==30
    assert len(sample.json['forecasts']['adaptive'][0]['positions'])==30
    assert client.post('/api/reforecast',json=dict(source_id='../secret',model_profile='flexible',history_seconds=2,horizon_seconds=1)).status_code==400
