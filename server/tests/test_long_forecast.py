import numpy as np
import torch
from temporal_model import ForecastTemporal,temporal_features
from dataset import sequence_anchors


def test_visibility_changes_cannot_create_velocity():
    p=torch.ones((2,80,9,3));v=torch.ones((2,80,9));v[:,50:,5]=.1
    features=temporal_features(p,v)
    assert torch.count_nonzero(features[:,:,27:54])==0


def test_long_direct_forecast_reacts_to_history_and_has_no_fake_rollout():
    torch.manual_seed(42);model=ForecastTemporal();model.eval()
    p=torch.zeros((1,80,9,3));v=torch.ones((1,80,9))
    with torch.inference_mode():
        still=model(temporal_features(p,v),p[:,-1])
        p[0,:,5,1]=torch.linspace(0,.5,80)
        moved=model(temporal_features(p,v),p[:,-1])
    assert moved.shape==(1,60,9,3)
    assert torch.count_nonzero(still)==0
    assert moved[0,-1,5,1]>p[0,-1,5,1]
    assert torch.all(moved[0,1:,5,1]>=moved[0,:-1,5,1])
    assert moved[0,-1,5,1]-p[0,-1,5,1]<.1 # bounded initial damped continuation


def test_three_second_targets_never_cross_shot_boundaries():
    s={'positions':np.zeros((300,9,3)),'_split':'train','segment_ids':np.repeat([0,1],150)}
    anchors=sequence_anchors(s,'train',history_frames=80,horizon_frames=60)
    assert anchors and all(s['segment_ids'][a-79]==s['segment_ids'][a+60] for a in anchors)
