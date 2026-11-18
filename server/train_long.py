"""Train directly supervised 0.5--3s forecasts on Full-pose observations.

Use fixed speaker partitions. Only validation selects epochs, gates and history.
The existing test people have been inspected in prior iterations: development
holdout results, not a fresh blind benchmark.
"""
import argparse, copy, json, random, time
from pathlib import Path
import numpy as np
import torch
from torch.utils.data import DataLoader, TensorDataset, WeightedRandomSampler
from motion import ROOT, FPS, errors, adaptive_forecast
from dataset import load_speaker_manifest, sequence_anchors, file_digest
from train_flexible import measure
from temporal_model import ForecastTemporal, trajectory_loss, temporal_features as tensor_features

HISTORIES=[40,60,80]
HORIZONS=[10,20,30,40,60]


def tensors(sequences,split,stride=4):
    values=[[],[],[],[]];people=[]
    for s in sequences:
        p,v=s['positions'],s['visibility']
        for a in sequence_anchors(s,split,stride,history_frames=80,horizon_frames=60):
            if any((v[a-h+1:a+1,1:7]>=.4).mean()<.35 for h in HISTORIES):continue
            if any((v[a+1:a+f+1,1:7]>=.4).mean()<.35 for f in HORIZONS):continue
            for rows,value in zip(values,[p[a-79:a+1],v[a-79:a+1],p[a+1:a+61],v[a+1:a+61]]):rows.append(value)
            people.append(s['_speaker'])
    if not people:raise ValueError(f'No valid {split} windows')
    return TensorDataset(*(torch.tensor(np.stack(x),dtype=torch.float32) for x in values)),people


def predict(model,data):
    out={h:[] for h in HISTORIES};model.eval()
    with torch.inference_mode():
        for p,v,_,_ in DataLoader(data,batch_size=128):
            for h in HISTORIES:out[h].append(model(tensor_features(p,v,h),p[:,-1]).numpy())
    return {h:np.concatenate(rows) for h,rows in out.items()}


def main(args):
    torch.set_num_threads(4);torch.manual_seed(42);np.random.seed(42);rng=random.Random(42)
    out=args.output_dir
    if (out/'forecast.pt').exists():raise ValueError('Choose a new output directory; existing run preserved.')
    out.mkdir(parents=True,exist_ok=True);started=time.perf_counter()
    sequences,provenance=load_speaker_manifest(args.manifest)
    train,_=tensors(sequences,'train');validation,val_people=tensors(sequences,'validation')
    model=ForecastTemporal();optimizer=torch.optim.AdamW(model.parameters(),lr=.0006,weight_decay=.001)
    p,v,_,_=train.tensors
    paired=(v[:,-20:,5:7]>=.4);valid=paired[:,1:]&paired[:,:-1]
    activity=(torch.linalg.vector_norm(torch.diff(p[:,-20:,5:7],dim=1),dim=-1)*valid).mean((1,2))
    sampling_weights=1+torch.clamp(activity/.03,max=2)
    sampler=WeightedRandomSampler(sampling_weights,len(train),replacement=True,generator=torch.Generator().manual_seed(42))
    loader=DataLoader(train,batch_size=48,sampler=sampler)
    best=copy.deepcopy(model.state_dict());best_loss=float('inf');stalled=0;history=[]
    print(json.dumps(dict(train=len(train),validation=len(validation),architecture='temporal_v4',max_future=60)),flush=True)
    for epoch in range(args.epochs):
        model.train();losses=[]
        for p,v,target,quality in loader:
            h=rng.choice(HISTORIES);optimizer.zero_grad()
            loss=trajectory_loss(model(tensor_features(p,v,h),p[:,-1]),target,quality,p[:,-1])
            loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1);optimizer.step();losses.append(loss.item())
        model.eval();val=[]
        with torch.inference_mode():
            for p,v,target,quality in DataLoader(validation,batch_size=128):
                for h in HISTORIES:val.append(trajectory_loss(model(tensor_features(p,v,h),p[:,-1]),target,quality,p[:,-1]).item())
        value=float(np.mean(val));row=dict(epoch=epoch+1,train_loss=float(np.mean(losses)),validation_loss=value)
        history.append(row);print(json.dumps(row),flush=True)
        if value<best_loss-1e-7:best=copy.deepcopy(model.state_dict());best_loss=value;stalled=0
        else:stalled+=1
        if stalled>=10:break
    model.load_state_dict(best);model.eval();vp,vv,vt,vq=[x.numpy() for x in validation.tensors]
    predictions=predict(model,validation);thresholds={};calibration={};validation_profiles={}
    for h in HISTORIES:
        for f in HORIZONS:
            key=f'{h}:{f}';scores={}
            for threshold in [.002,.005,.01,.02,.04]:
                groups={}
                for i in range(len(vp)):
                    estimate=adaptive_forecast(vp[i,-h:],vv[i,-h:],predictions[h][i,:f],threshold)
                    groups.setdefault(val_people[i],[]).append(errors(estimate,vt[i,:f],vq[i,:f])['ade'])
                scores[str(threshold)]=float(np.mean([np.mean(values) for values in groups.values()]))
            thresholds[key]=float(min(scores,key=scores.get));calibration[key]=scores
            validation_profiles[key]=measure(vp,vv,vt,vq,predictions[h],val_people,h,f,thresholds[key])
    chosen_h=min(HISTORIES,key=lambda h:validation_profiles[f'{h}:40']['speaker_macro_metrics']['adaptive']['ade'])
    metadata=dict(history_options_frames=HISTORIES,horizon_options_frames=HORIZONS,default_history_frames=chosen_h,default_horizon_frames=40,
        training_windows=len(train),validation_windows=len(validation),best_validation_loss=best_loss,gate_thresholds=thresholds,
        data_provenance=provenance,training_type='from_scratch_temporal_v4',architecture='temporal_convolution_ordered_pooling_smooth_knots_damped_motion',
        pose_backend='mediapipe_full_33_adaptive_v1',predicted_joint_count=9,observed_joint_count=33,
        seed=42,learning_rate=.0006,batch_size=48,loss='Shoulder-normalized masked SmoothL1, wrist weight2, elbow1.3, velocity loss0.15; motion sampling weight1..3 from training history only.',
        selection='Epoch from validation loss averaged over 2/3/4s. Gates from validation speaker-macro ADE. Default history by macro ADE at2s; default2s is a usability proposal. No selection by display motion amplitude.',
        protocol='All15 timing combinations use the same 4s+3s eligible anchors and speaker partitions. Smoothly interpolated quarter-second learned future key poses; all60 future steps supervised. No repeated1.5s rollouts or time stretching. Full pose was re-extracted on the same reviewed clips. Only9 joints forecast; palm/head detail is current observation.',
        fps=FPS,old_test_previously_inspected=True)
    checkpoint=dict(model_type='temporal_v4',state_dict=best,hidden_size=64,horizon_frames=60,metadata=metadata)
    torch.save(checkpoint,out/'forecast.pt')
    test,test_people=tensors(sequences,'test',stride=5);tp,tv,tt,tq=[x.numpy() for x in test.tensors];test_predictions=predict(model,test)
    profiles={}
    for h in HISTORIES:
        for f in HORIZONS:
            value=measure(tp,tv,tt,tq,test_predictions[h],test_people,h,f,thresholds[f'{h}:{f}'])
            value['mean_predicted_wrist_endpoint_displacement']=float(np.linalg.norm(test_predictions[h][:,f-1,5:7]-tp[:,-1,5:7],axis=-1).mean())
            profiles[f'{h}:{f}']=value
    record=dict(metadata=metadata,history=history,gate_calibration=calibration,validation_profiles=validation_profiles,profiles=profiles,
                model_sha256=file_digest(out/'forecast.pt'),elapsed_seconds=time.perf_counter()-started)
    (out/'evaluation.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(dict(default_history=chosen_h/20,test_windows=len(test),elapsed=record['elapsed_seconds'],metrics={k:v['metrics']['adaptive'] for k,v in profiles.items()})),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--manifest',type=Path,default=ROOT/'data/fine-20261105/speaker_manifest.json')
    parser.add_argument('--output-dir',type=Path,default=ROOT/'runs/long-fine-v4');parser.add_argument('--epochs',type=int,default=60)
    main(parser.parse_args())
