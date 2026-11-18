import numpy as np
import torch
from audio_features import block_features,align_features,DIM
from audio_motion import ForecastAudio


def test_features_finite_silence_and_causal_alignment():
    samples=np.sin(2*np.pi*200*np.arange(16000)/16000).astype(np.float32)*.1
    feats=block_features(samples)
    assert feats.shape==(20,DIM) and np.isfinite(feats).all()
    assert np.isfinite(block_features(np.zeros(1600,np.float32))).all()
    times=np.array([0,.049,.05,.10,.999])
    result=align_features(feats,times)
    assert (result[:2]==0).all()
    np.testing.assert_array_equal(result[2],feats[0])
    changed=samples.copy();changed[8000:]=100
    np.testing.assert_array_equal(align_features(block_features(changed),np.array([.25,.5])),align_features(feats,np.array([.25,.5])))


def test_adapter_training_frozen_base_and_deterministic_eval():
    torch.set_num_threads(2);torch.manual_seed(42)
    model=ForecastAudio();p=torch.randn(2,40,9,3)*.1;v=torch.ones(2,40,9);a=torch.randn(2,40,DIM);a[:,:,-1]=1
    model.train();pred=model(p,v,a);assert pred.shape==(2,60,9,3)
    loss=(pred-(p[:,-1:,]+.1)).square().mean();loss.backward()
    assert all(param.grad is None for param in model.base.parameters())
    assert model.head[-1].weight.grad.abs().sum()>0
    # Once learned residual weights are nonzero, audio and pose both affect output.
    with torch.no_grad():model.head[-1].weight.normal_(0,.01)
    model.eval()
    with torch.inference_mode():
        first=model(p,v,a);second=model(p,v,a);muted=model(p,v,torch.zeros_like(a))
    assert torch.equal(first,second)
    assert not torch.equal(first,muted)
    control=ForecastAudio(use_audio=False);control.load_state_dict(model.state_dict());control.eval()
    with torch.inference_mode():assert torch.equal(control(p,v,a),control(p,v,torch.zeros_like(a)))
