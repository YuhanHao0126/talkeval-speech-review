"""Trainable audio/pose residual adapter on a frozen, versioned TCN baseline."""
import torch
from torch import nn
from torch.nn import functional as F
from temporal_model import ForecastTemporal,temporal_features
from audio_features import DIM


class ForecastAudio(nn.Module):
    def __init__(self,use_audio=True):
        super().__init__();self.use_audio=use_audio
        self.base=ForecastTemporal();self.base.requires_grad_(False)
        self.pose_encoder=nn.Sequential(nn.Conv1d(63,32,5,padding=2),nn.SiLU(),nn.Conv1d(32,32,3,padding=2,dilation=2),nn.SiLU(),nn.AdaptiveAvgPool1d(4))
        self.audio_encoder=nn.Sequential(nn.Conv1d(DIM,16,5,padding=2),nn.SiLU(),nn.Conv1d(16,16,3,padding=2,dilation=2),nn.SiLU(),nn.AdaptiveAvgPool1d(4))
        self.head=nn.Sequential(nn.Linear(192,96),nn.SiLU(),nn.Dropout(.1),nn.Linear(96,12*27))
        nn.init.zeros_(self.head[-1].weight);nn.init.zeros_(self.head[-1].bias)
        self.register_buffer('audio_mean',torch.zeros(DIM-1));self.register_buffer('audio_std',torch.ones(DIM-1))

    def train(self,mode=True):
        super().train(mode);self.base.eval();return self

    def forward(self,p,v,a):
        inputs=temporal_features(p,v)
        with torch.no_grad():base=self.base(inputs,p[:,-1])
        valid=a[:,:,-1:]
        normalized=((a[:,:,:-1]-self.audio_mean)/self.audio_std).clamp(-5,5)*valid
        audio=torch.cat((normalized,valid),dim=-1)
        if not self.use_audio:audio=torch.zeros_like(audio)
        encoded=torch.cat((self.pose_encoder(inputs.transpose(1,2)).flatten(1),self.audio_encoder(audio.transpose(1,2)).flatten(1)),dim=1)
        residual=.35*torch.tanh(self.head(encoded).reshape(-1,12,27))
        residual=torch.cat((torch.zeros_like(residual[:,:1]),residual),dim=1)
        residual=F.interpolate(residual.transpose(1,2),size=61,mode='linear',align_corners=True).transpose(1,2)[:,1:].reshape(-1,60,9,3)
        return base+residual


class AudioPredictor:
    def __init__(self,path):
        checkpoint=torch.load(path,map_location='cpu',weights_only=True)
        self.model=ForecastAudio(use_audio=checkpoint['use_audio']);self.model.load_state_dict(checkpoint['state_dict']);self.model.eval()
        self.metadata=checkpoint['metadata']

    def predict(self,p,v,a,horizon_frames):
        import numpy as np
        if len(p) not in [40,60,80] or horizon_frames not in [10,20,30,40,60]:raise ValueError('声音融合模型支持观察2/3/4秒、预测0.5/1/1.5/2/3秒。')
        if np.shape(a)!=(len(p),DIM) or not np.isfinite(a).all():raise ValueError('声学特征形状或数值无效。')
        with torch.inference_mode():
            return self.model(*(torch.as_tensor(x,dtype=torch.float32)[None] for x in [p,v,a]))[0,:horizon_frames].numpy()
