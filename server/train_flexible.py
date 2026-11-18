"""Train variable observed histories and direct future outputs, using fixed speaker splits."""
from pathlib import Path
import argparse
import copy
import json
import random
import time
import numpy as np
import torch
from torch.utils.data import DataLoader, TensorDataset
from motion import ROOT, FPS, ForecastGRU, masked_loss, errors, baseline_forecast, adaptive_forecast
from dataset import load_speaker_manifest, sequence_anchors, file_digest
from train import summarize

HISTORIES=[40,60,80]
HORIZONS=[10,20,30]


def tensors(sequences, split, stride=4):
    positions=[];visibility=[];targets=[];weights=[];people=[]
    for sequence in sequences:
        p,v=sequence['positions'],sequence['visibility']
        for a in sequence_anchors(sequence,split,stride,history_frames=80,horizon_frames=30):
            if any((v[a-h+1:a+1,1:7]>=.4).mean()<.35 for h in HISTORIES):continue
            if any((v[a+1:a+f+1,1:7]>=.4).mean()<.35 for f in HORIZONS):continue
            positions.append(p[a-79:a+1]);visibility.append(v[a-79:a+1])
            targets.append(p[a+1:a+31]);weights.append(v[a+1:a+31]);people.append(sequence['_speaker'])
    if not positions:raise ValueError(f'{split}: no common 4s+1.5s windows')
    return TensorDataset(*(torch.tensor(np.stack(x),dtype=torch.float32) for x in [positions,visibility,targets,weights])),people


def tensor_features(p,v,h):
    p,v=p[:,-h:],v[:,-h:];masked=p*v[...,None]
    difference=torch.zeros_like(masked);difference[:,1:]=masked[:,1:]-masked[:,:-1]
    return torch.cat((masked.flatten(2),difference.flatten(2),v),dim=-1)


def predictions(model,data):
    result={h:[] for h in HISTORIES}
    model.eval()
    with torch.inference_mode():
        for p,v,_,_ in DataLoader(data,batch_size=128):
            for h in HISTORIES:result[h].append(model(tensor_features(p,v,h),p[:,-1]).numpy())
    return {h:np.concatenate(values) for h,values in result.items()}


def measure(p,v,target,quality,predicted,people,h,f,threshold):
    measurements={key:[] for key in ['gru','adaptive','persistence','velocity']};per_person={}
    for i in range(len(p)):
        methods={'gru':predicted[i,:f], 'adaptive':adaptive_forecast(p[i,-h:],v[i,-h:],predicted[i,:f],threshold),
                 'persistence':baseline_forecast(p[i,-h:],'persistence',f),'velocity':baseline_forecast(p[i,-h:],'velocity',f)}
        for method,value in methods.items():
            metric=errors(value,target[i,:f],quality[i,:f]);measurements[method].append(metric)
            per_person.setdefault(people[i],{key:[] for key in methods})[method].append(metric)
    by_person={s:summarize(rows) for s,rows in per_person.items()}
    macro={m:{k:float(np.mean([r[m][k] for r in by_person.values() if r[m][k] is not None])) for k in ['ade','fde','wrist_ade']} for m in measurements}
    return dict(metrics=summarize(measurements),speaker_macro_metrics=macro,per_speaker_metrics=by_person)


def main(args):
    torch.set_num_threads(4);torch.manual_seed(42);np.random.seed(42);random.seed(42)
    rng=random.Random(42);started=time.perf_counter()
    out=Path(args.output_dir)
    if (out/'forecast.pt').exists():raise ValueError('Output weights already exist; choose a new run directory.')
    out.mkdir(parents=True,exist_ok=True)
    sequences,provenance=load_speaker_manifest(args.manifest)
    train,_=tensors(sequences,'train');validation,val_people=tensors(sequences,'validation')
    model=ForecastGRU(horizon_frames=30)
    optimizer=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.0001)
    loader=DataLoader(train,batch_size=48,shuffle=True,generator=torch.Generator().manual_seed(42))
    best,best_loss,stalled=copy.deepcopy(model.state_dict()),float('inf'),0;history=[]
    print(json.dumps({'training_windows':len(train),'validation_windows':len(validation),'history_frames':HISTORIES,'horizon_frames':HORIZONS}),flush=True)
    for epoch in range(args.epochs):
        model.train();losses=[]
        for p,v,target,quality in loader:
            h=rng.choice(HISTORIES);optimizer.zero_grad()
            loss=masked_loss(model(tensor_features(p,v,h),p[:,-1]),target,quality)
            loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1);optimizer.step();losses.append(loss.item())
        model.eval();val=[]
        with torch.inference_mode():
            for p,v,target,quality in DataLoader(validation,batch_size=128):
                for h in HISTORIES:val.append(masked_loss(model(tensor_features(p,v,h),p[:,-1]),target,quality).item())
        value=float(np.mean(val));row=dict(epoch=epoch+1,train_loss=float(np.mean(losses)),validation_loss=value)
        history.append(row);print(json.dumps(row),flush=True)
        if value<best_loss-1e-7:best=copy.deepcopy(model.state_dict());best_loss=value;stalled=0
        else:stalled+=1
        if stalled>=10:break
    model.load_state_dict(best);model.eval()
    val_pred=predictions(model,validation);vp,vv,vt,vq=[x.numpy() for x in validation.tensors]
    thresholds={};calibration={};validation_profiles={}
    for h in HISTORIES:
        for f in HORIZONS:
            key=f'{h}:{f}';scores={}
            for threshold in [.002,.005,.01,.02,.04]:
                groups={}
                for i in range(len(vp)):
                    estimate=adaptive_forecast(vp[i,-h:],vv[i,-h:],val_pred[h][i,:f],threshold)
                    groups.setdefault(val_people[i],[]).append(errors(estimate,vt[i,:f],vq[i,:f])['ade'])
                scores[str(threshold)]=float(np.mean([np.mean(values) for values in groups.values()]))
            thresholds[key]=float(min(scores,key=scores.get));calibration[key]=scores
            validation_profiles[key]=measure(vp,vv,vt,vq,val_pred[h],val_people,h,f,thresholds[key])
    chosen_h=min(HISTORIES,key=lambda h:validation_profiles[f'{h}:20']['speaker_macro_metrics']['adaptive']['ade'])
    metadata=dict(history_options_frames=HISTORIES,horizon_options_frames=HORIZONS,default_history_frames=chosen_h,default_horizon_frames=20,
                  training_windows=len(train),validation_windows=len(validation),best_validation_loss=best_loss,gate_thresholds=thresholds,
                  data_provenance=provenance,training_type='from_scratch_mixed_history',seed=42,learning_rate=.001,batch_size=48,
                  selection='Epoch from validation SmoothL1 averaged over 2/3/4s histories. Gate per combination from validation speaker-macro ADE. Default history from validation macro ADE at fixed1s. Default1s horizon is a usability proposal, not a proven reaction-time optimum.',
                  protocol='All 9 combinations share anchors requiring 4s history plus1.5s future and pass each prefix visibility filter. Speaker split unchanged. Test not used for training, epoch, gate or default selection. Histories are randomly cropped per batch; 30 future frames directly supervised and output prefixes used; no rollout/time stretching.',
                  fps=FPS,old_test_previously_inspected=True)
    checkpoint=dict(state_dict=best,hidden_size=64,horizon_frames=30,metadata=metadata)
    torch.save(checkpoint,out/'forecast.pt')
    test,test_people=tensors(sequences,'test',stride=5);tp,tv,tt,tq=[x.numpy() for x in test.tensors];test_pred=predictions(model,test)
    profiles={f'{h}:{f}':measure(tp,tv,tt,tq,test_pred[h],test_people,h,f,thresholds[f'{h}:{f}']) for h in HISTORIES for f in HORIZONS}
    record=dict(metadata=metadata,history=history,gate_calibration=calibration,validation_profiles=validation_profiles,profiles=profiles,
                model_sha256=file_digest(out/'forecast.pt'),elapsed_seconds=time.perf_counter()-started)
    (out/'evaluation.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'default_history_seconds':chosen_h/FPS,'horizon_seconds':1,'test_windows':len(test),'elapsed_seconds':record['elapsed_seconds'],
                      'metrics':{k:r['metrics']['adaptive'] for k,r in profiles.items()}},indent=2),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--manifest',type=Path,default=ROOT/'data/expanded-20261105/speaker_manifest.reviewed.json')
    parser.add_argument('--output-dir',type=Path,default=ROOT/'runs/flexible-windows-v3');parser.add_argument('--epochs',type=int,default=60)
    main(parser.parse_args())
