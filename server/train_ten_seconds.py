"""Direct supervised 10s exploratory model; no recursive rollout or time stretching."""
import copy,json,random,time
import numpy as np
import torch
from torch.utils.data import DataLoader,TensorDataset
from motion import ROOT,errors,adaptive_forecast
from dataset import load_speaker_manifest,sequence_anchors,file_digest
from temporal_model import ForecastTemporal,temporal_features,trajectory_loss
from train_flexible import measure

HISTORIES=[40,60,80,100,120,140,160,180,200]
HORIZONS=[10,20,30,40,60,80,100,120,140,160,180,200]
OUT=ROOT/'runs/ten-seconds-v5'

def tensors(sequences,split,stride=5):
    arrays=[[],[],[],[]];people=[]
    for seq in sequences:
        p,v=seq['positions'],seq['visibility']
        for a in sequence_anchors(seq,split,stride,history_frames=200,horizon_frames=200):
            if any((v[a-h+1:a+1,1:7]>=.4).mean()<.35 for h in HISTORIES):continue
            if (v[a+1:a+201,1:7]>=.4).mean()<.35 or (v[a,1:7]>=.4).mean()<.5:continue
            for rows,value in zip(arrays,[p[a-199:a+1],v[a-199:a+1],p[a+1:a+201],v[a+1:a+201]]):rows.append(value)
            people.append(seq['_speaker'])
    if not people:raise ValueError('No eligible 10+10s windows in '+split)
    return TensorDataset(*(torch.tensor(np.stack(a),dtype=torch.float32) for a in arrays)),people

def predict(model,data):
    out={h:[] for h in HISTORIES};model.eval()
    with torch.inference_mode():
        for p,v,_,_ in DataLoader(data,batch_size=64):
            for h in HISTORIES:out[h].append(model(temporal_features(p,v,h),p[:,-1]).numpy())
    return {h:np.concatenate(rows) for h,rows in out.items()}

def main():
    if (OUT/'forecast.pt').exists():raise ValueError('Existing run preserved.')
    OUT.mkdir(exist_ok=True);began=time.perf_counter();torch.set_num_threads(4);torch.manual_seed(42);np.random.seed(42);rng=random.Random(42)
    seq,provenance=load_speaker_manifest(ROOT/'data/extended-10s-v1/speaker_manifest.json')
    train,_=tensors(seq,'train');val,val_people=tensors(seq,'validation');test,test_people=tensors(seq,'test')
    model=ForecastTemporal(horizon_frames=200)
    old=torch.load(ROOT/'runs/long-fine-v4/forecast.pt',map_location='cpu',weights_only=True)['state_dict'];state=model.state_dict()
    copied=[k for k,v in old.items() if k in state and v.shape==state[k].shape]
    state.update({k:old[k] for k in copied});model.load_state_dict(state)
    optimizer=torch.optim.AdamW(model.parameters(),lr=.0004,weight_decay=.001)
    loader=DataLoader(train,batch_size=32,shuffle=True,generator=torch.Generator().manual_seed(42))
    best,best_loss,stalled,history=copy.deepcopy(model.state_dict()),float('inf'),0,[]
    print(json.dumps(dict(train=len(train),validation=len(val),development_test=len(test),warm_started=copied)),flush=True)
    for epoch in range(30):
        model.train();losses=[]
        for p,v,target,quality in loader:
            h=rng.choice(HISTORIES);optimizer.zero_grad();pred=model(temporal_features(p,v,h),p[:,-1])
            loss=trajectory_loss(pred,target,quality,p[:,-1]);loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1);optimizer.step();losses.append(loss.item())
        model.eval();values=[]
        with torch.inference_mode():
            for p,v,target,quality in DataLoader(val,batch_size=64):
                for h in HISTORIES:values.append(trajectory_loss(model(temporal_features(p,v,h),p[:,-1]),target,quality,p[:,-1]).item())
        value=float(np.mean(values));row=dict(epoch=epoch+1,train_loss=float(np.mean(losses)),validation_loss=value);history.append(row);print(json.dumps(row),flush=True)
        if value<best_loss-1e-7:best=copy.deepcopy(model.state_dict());best_loss=value;stalled=0
        else:stalled+=1
        if stalled>=7:break
    model.load_state_dict(best);vp,vv,vt,vq=[x.numpy() for x in val.tensors];preds=predict(model,val);thresholds={};calibration={}
    for h in HISTORIES:
        for f in HORIZONS:
            scores={}
            for threshold in [.002,.01,.04]:
                groups={}
                for i,person in enumerate(val_people):groups.setdefault(person,[]).append(errors(adaptive_forecast(vp[i,-h:],vv[i,-h:],preds[h][i,:f],threshold),vt[i,:f],vq[i,:f])['ade'])
                scores[str(threshold)]=float(np.mean([np.mean(x) for x in groups.values()]))
            key=f'{h}:{f}';thresholds[key]=float(min(scores,key=scores.get));calibration[key]=scores
    metadata=dict(history_options_frames=HISTORIES,horizon_options_frames=HORIZONS,default_history_frames=100,default_horizon_frames=100,
        training_windows=len(train),validation_windows=len(val),development_test_windows=len(test),best_validation_loss=best_loss,
        data_provenance=provenance,gate_thresholds=thresholds,architecture='temporal_convolution_ordered_pooling_smooth_knots_damped_motion',
        training_type='encoder_and_hidden_head_warm_start_from_v4_new_200_frame_head',warm_start_sha256=file_digest(ROOT/'runs/long-fine-v4/forecast.pt'),warm_start_keys=copied,
        pose_backend='mediapipe_full_33_adaptive_v1',predicted_joint_count=9,observed_joint_count=33,fps=20,exploratory=True,seed=42,
        selection='Epoch by validation loss across9 histories; gate by validation speaker macro ADE. No choice by visible motion amplitude.',
        protocol='Continuous36s clips; all timing profiles share eligible10s+10s windows; no detected shot crossings. All200 future steps directly supervised; no recursive rollout, copied poses or stretched timeline. Same pre-inspected people as prior development, not blind holdout. 10s is exploratory, not reliable motion guidance.')
    torch.save(dict(model_type='temporal_v4',state_dict=best,hidden_size=64,horizon_frames=200,metadata=metadata),OUT/'forecast.pt')
    tp,tv,tt,tq=[x.numpy() for x in test.tensors];preds=predict(model,test);profiles={}
    for h in HISTORIES:
        for f in HORIZONS:
            key=f'{h}:{f}';value=measure(tp,tv,tt,tq,preds[h],test_people,h,f,thresholds[key])
            value['raw_wrist_endpoint_displacement']=float(np.linalg.norm(preds[h][:,f-1,5:7]-tp[:,-1,5:7],axis=-1).mean())
            value['actual_wrist_endpoint_displacement']=float(np.linalg.norm(tt[:,f-1,5:7]-tp[:,-1,5:7],axis=-1).mean());profiles[key]=value
    report=dict(metadata=metadata,history=history,gate_calibration=calibration,profiles=profiles,model_sha256=file_digest(OUT/'forecast.pt'),elapsed_seconds=time.perf_counter()-began)
    (OUT/'evaluation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps({k:profiles[k]['metrics'] for k in ['40:40','100:100','200:200']}),flush=True)
if __name__=='__main__':main()
