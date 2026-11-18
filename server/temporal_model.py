"""Compact temporal encoder with ordered history pooling and smooth direct futures."""
import math
import torch
from torch import nn
from torch.nn import functional as F


def temporal_features(p,v,h=None):
    if h is not None:p,v=p[:,-h:],v[:,-h:]
    masked=p*v[...,None];difference=torch.zeros_like(masked)
    # A confidence change is not motion: differentiate coordinates first.
    difference[:,1:]=(p[:,1:]-p[:,:-1])*torch.minimum(v[:,1:],v[:,:-1])[...,None]
    return torch.cat((masked.flatten(2),difference.flatten(2),v),dim=-1)


class ForecastTemporal(nn.Module):
    def __init__(self, hidden_size=64, horizon_frames=60):
        super().__init__()
        self.horizon_frames=horizon_frames
        self.encoder=nn.Sequential(
            nn.Conv1d(63,hidden_size,5,padding=2),nn.SiLU(),
            nn.Conv1d(hidden_size,hidden_size,5,padding=4,dilation=2),nn.SiLU(),
            nn.Conv1d(hidden_size,hidden_size,5,padding=8,dilation=4),nn.SiLU(),
            nn.AdaptiveAvgPool1d(8))
        self.knots=math.ceil(horizon_frames/5)
        self.head=nn.Sequential(nn.Flatten(),nn.Linear(hidden_size*8,128),nn.SiLU(),nn.Dropout(.15),nn.Linear(128,self.knots*27))
        nn.init.zeros_(self.head[-1].weight);nn.init.zeros_(self.head[-1].bias)
        self.velocity_gain=nn.Parameter(torch.full((9,1),-1.4))

    def forward(self,inputs,last_pose):
        residual=self.head(self.encoder(inputs.transpose(1,2))).reshape(-1,self.knots,27)
        # Every output step is directly supervised. Interpolation smooths the
        # learned 0.25s key poses, with the initial pose exactly anchored at t=0.
        residual=torch.cat((torch.zeros_like(residual[:,:1]),residual),dim=1)
        residual=F.interpolate(residual.transpose(1,2),size=self.horizon_frames+1,mode='linear',align_corners=True).transpose(1,2)[:,1:].reshape(-1,self.horizon_frames,9,3)
        velocity=inputs[:,-5:,27:54].median(dim=1).values.reshape(-1,9,3)*20
        t=torch.arange(1,self.horizon_frames+1,device=inputs.device,dtype=inputs.dtype)/20
        drift=.6*(1-torch.exp(-t/.6))
        continuation=drift[None,:,None,None]*velocity[:,None]*self.velocity_gain.sigmoid()[None,None]
        return last_pose[:,None]+continuation+residual


def trajectory_loss(prediction,target,quality,last_pose):
    weights=(quality>=.4).float()*quality
    joint_weights=prediction.new_tensor([.5,1,1,1.3,1.3,2,2,.5,.5])
    weights=weights*joint_weights
    distance=F.smooth_l1_loss(prediction,target,reduction='none').mean(dim=-1)
    position=(distance*weights).sum()/weights.sum().clamp_min(1)
    pp=torch.diff(torch.cat((last_pose[:,None],prediction),dim=1),dim=1)
    tt=torch.diff(torch.cat((last_pose[:,None],target),dim=1),dim=1)
    valid=weights.clone();valid[:,1:]=torch.minimum(weights[:,1:],weights[:,:-1])
    velocity=(F.smooth_l1_loss(pp,tt,reduction='none').mean(dim=-1)*valid).sum()/valid.sum().clamp_min(1)
    return position+.15*velocity
