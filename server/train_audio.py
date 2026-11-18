"""One predeclared paired-speaker experiment, with matched pose-only control.

Checkpoint selection: validation speaker-macro mean(ADE,wrist ADE), averaged
over 2/3/4s histories and 2/3s horizons. Test is read once after selection.
Existing development-test people were inspected in earlier iterations.
"""
import copy,json,random,time,argparse
from pathlib import Path
import numpy as np
import torch
from torch.utils.data import TensorDataset,DataLoader,WeightedRandomSampler
from audio_motion import ForecastAudio
from dataset import file_digest,sequence_anchors
from motion import ROOT,load_sequence,adaptive_forecast,baseline_forecast,Predictor
from temporal_model import trajectory_loss

HISTORIES=[40,60,80]
HORIZONS=[10,20,30,40,60]
OUT=ROOT/'runs/audio-fusion-v15'


def load_data():
    path=ROOT/'data/audio-paired-v15/manifest.json';doc=json.loads(path.read_text('utf-8'))
    rows=[r for r in doc['recordings'] if r['status']=='paired'];speaker_splits={}
    splits={}
    for split in ['train','validation','test']:
        arrays=[[] for _ in range(5)];people=[];anchors=[]
        for r in rows:
            if r['split']!=split:continue
            person=r['speaker_id']
            if person in speaker_splits and speaker_splits[person]!=split:raise ValueError('Speaker leakage')
            speaker_splits[person]=split
            pose_path=ROOT/'data/fine-20261105'/r['sequence_path']
            seq=load_sequence(pose_path if pose_path.is_file() else Path(r['pose_path']));seq['_split']=split
            with np.load(path.parent/r['audio_feature_path'],allow_pickle=False) as d:audio=d['features']
            p,v=seq['positions'],seq['visibility']
            for anchor in sequence_anchors(seq,split,5 if split=='test' else 4,history_frames=80,horizon_frames=60):
                if any((v[anchor-h+1:anchor+1,1:7]>=.4).mean()<.35 for h in HISTORIES):continue
                if any((v[anchor+1:anchor+f+1,1:7]>=.4).mean()<.35 for f in HORIZONS):continue
                aa=audio[anchor-79:anchor+1]
                if aa[:,-1].mean()<.95:continue
                for target,value in zip(arrays,[p[anchor-79:anchor+1],v[anchor-79:anchor+1],aa,p[anchor+1:anchor+61],v[anchor+1:anchor+61]]):target.append(value)
                people.append(person);anchors.append(dict(record=r['record_index'],anchor=anchor))
        if not people:raise ValueError('No paired windows for '+split)
        splits[split]=(TensorDataset(*(torch.tensor(np.stack(a),dtype=torch.float32) for a in arrays)),people,anchors)
    return splits,dict(manifest_sha256=file_digest(path),speaker_splits=speaker_splits,recordings=len(rows),excluded_recordings=len(doc['recordings'])-len(rows),counts={s:dict(windows=len(d[0]),speakers=len(set(d[1]))) for s,d in splits.items()})


def metric_table(pred,target,quality,people):
    dist=np.linalg.norm(pred-target,axis=-1);mask=quality>=.4
    def avg(values,valid,axes):
        n=valid.sum(axis=axes);return np.divide((values*valid).sum(axis=axes),n,out=np.full(n.shape,np.nan),where=n>0)
    rows=dict(ade=avg(dist,mask,(1,2)),fde=avg(dist[:,-1],mask[:,-1],1),
              wrist_ade=avg(dist[:,:,5:7],mask[:,:,5:7],(1,2)),elbow_ade=avg(dist[:,:,3:5],mask[:,:,3:5],(1,2)))
    names=np.asarray(people)
    by_person={p:{k:float(np.nanmean(value[names==p])) for k,value in rows.items()} for p in sorted(set(people))}
    return dict(metrics={k:float(np.nanmean(v)) for k,v in rows.items()},speaker_macro={k:float(np.mean([r[k] for r in by_person.values()])) for k in rows},per_speaker=by_person,windows=len(people))


def infer(model,dataset,h,audio_mode=None):
    out=[];model.eval()
    with torch.inference_mode():
        for p,v,a,_,_ in DataLoader(dataset,batch_size=128):
            if audio_mode=='zero':a=torch.zeros_like(a)
            if audio_mode=='reversed':a=a.flip(1) # analysis-only ablation, never live inference
            out.append(model(p[:,-h:],v[:,-h:],a[:,-h:]).numpy())
    return np.concatenate(out)


def validation_score(model,dataset,people):
    target,quality=[x.numpy() for x in dataset.tensors[-2:]];scores=[]
    for h in HISTORIES:
        pred=infer(model,dataset,h)
        for f in [40,60]:
            m=metric_table(pred[:,:f],target[:,:f],quality[:,:f],people)['speaker_macro']
            scores.append((m['ade']+m['wrist_ade'])/2)
    return float(np.mean(scores))


def train_variant(use_audio,train,val,people,base,mean,std,metadata,epochs):
    torch.manual_seed(42);rng=random.Random(42);model=ForecastAudio(use_audio=use_audio)
    model.base.load_state_dict(base);model.audio_mean.copy_(mean);model.audio_std.copy_(std)
    optimizer=torch.optim.AdamW([p for p in model.parameters() if p.requires_grad],lr=.0003,weight_decay=.005)
    p,v=train.tensors[:2];valid=(v[:,-20:,5:7]>=.4);paired=valid[:,1:]&valid[:,:-1]
    activity=(torch.linalg.vector_norm(torch.diff(p[:,-20:,5:7],dim=1),dim=-1)*paired).mean((1,2))
    sampler=WeightedRandomSampler(1+torch.clamp(activity/.03,max=2),len(train),generator=torch.Generator().manual_seed(42))
    loader=DataLoader(train,batch_size=48,sampler=sampler)
    best=float('inf');state=None;stalled=0;history=[];best_epoch=0;name='audio' if use_audio else 'pose_control'
    initial=validation_score(model,val,people)
    print(json.dumps(dict(variant=name,initial_validation=initial,trainable=sum(p.numel() for p in model.parameters() if p.requires_grad))),flush=True)
    for epoch in range(1,epochs+1):
        model.train();losses=[]
        for p,v,a,target,quality in loader:
            h=rng.choice(HISTORIES);optimizer.zero_grad()
            pred=model(p[:,-h:],v[:,-h:],a[:,-h:]);loss=trajectory_loss(pred,target,quality,p[:,-1])
            loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1);optimizer.step();losses.append(loss.item())
        score=validation_score(model,val,people)
        row=dict(epoch=epoch,train_loss=float(np.mean(losses)),validation_score=score);history.append(row)
        print(json.dumps(dict(variant=name,**row)),flush=True)
        if score<best-1e-7:best=score;best_epoch=epoch;state=copy.deepcopy(model.state_dict());stalled=0
        else:stalled+=1
        if stalled>=6:break
    model.load_state_dict(state);model.eval()
    record=dict(**metadata,variant=name,best_epoch=best_epoch,initial_validation=initial,best_validation=best,seed=42,learning_rate=.0003,batch_size=48,
                trainable_parameters=sum(p.numel() for p in model.parameters() if p.requires_grad),parameter_count=sum(p.numel() for p in model.parameters()),
                selection='Validation speaker-macro mean of ADE and wrist ADE over histories2/3/4s and futures2/3s; best trained epoch, patience6; no test-based selection',
                architecture='Frozen v4 pose TCN + trainable pose/audio Conv1d encoders + bounded smooth residual head',history_frames=HISTORIES,horizon_frames=HORIZONS)
    path=OUT/('forecast.pt' if use_audio else 'pose_control.pt')
    torch.save(dict(model_type='audio_adapter_v15',use_audio=use_audio,state_dict=state,metadata=record),path)
    return model,dict(metadata=record,history=history,sha256=file_digest(path))


def main(epochs):
    if (OUT/'forecast.pt').exists():raise ValueError('Existing training run preserved')
    OUT.mkdir(parents=True,exist_ok=True);start=time.perf_counter();torch.set_num_threads(4);torch.use_deterministic_algorithms(True)
    splits,provenance=load_data();train,_,_=splits['train'];val,val_people,_=splits['validation'];test,test_people,anchors=splits['test']
    audio=train.tensors[2];valid=audio[:,:,-1]>.5;values=audio[:,:,:-1][valid]
    mean=values.mean(0);std=values.std(0).clamp_min(.05)
    base_path=ROOT/'runs/long-fine-v4/forecast.pt';base=torch.load(base_path,map_location='cpu',weights_only=True)['state_dict']
    metadata=dict(provenance=provenance,base_sha256=file_digest(base_path),audio_features='log RMS,zero crossings,8 log frequency bands,autocorrelation log F0,periodicity,validity',audio_dimension=13,
                  normalization='mean/std on training-window audio only; missing mask retained',fps=20,predicted_joint_count=9,old_test_previously_inspected=True,
                  protocol='Frozen old pose model; matched pose-only adapter control with same initialization/data/optimizer/capacity and zeroed audio. No extra people. Targets are monocular pose estimates, not mocap truth.')
    print(json.dumps(dict(data=provenance['counts'],paired_clips=provenance['recordings'])),flush=True)
    pose,pose_run=train_variant(False,train,val,val_people,base,mean,std,metadata,epochs)
    audio_model,audio_run=train_variant(True,train,val,val_people,base,mean,std,metadata,epochs)
    # Commit all model choices before reading test results.
    (OUT/'training.json').write_text(json.dumps(dict(pose_control=pose_run,audio=audio_run),ensure_ascii=False,indent=2),'utf-8')
    tp,tv,ta,tt,tq=[x.numpy() for x in test.tensors]
    v4=Predictor(base_path);v5=Predictor(ROOT/'runs/ten-seconds-v5/forecast.pt')
    profiles={};predictions_to_save={}
    for h in HISTORIES:
        new=infer(audio_model,test,h);control=infer(pose,test,h);zero=infer(audio_model,test,h,'zero')
        old=np.stack([v4.predict(p[-h:],v[-h:],'gru',horizon_frames=60) for p,v in zip(tp,tv)])
        long=np.stack([v5.predict(p[-h:],v[-h:],'gru',horizon_frames=60) for p,v in zip(tp,tv)])
        for f in HORIZONS:
            estimates=dict(audio_fusion=new[:,:f],pose_control=control[:,:f],audio_zero_ablation=zero[:,:f],v4_raw=old[:,:f],v5_raw=long[:,:f],
                           persistence=np.repeat(tp[:,-1:,],f,axis=1),velocity=np.stack([baseline_forecast(p[-h:],'velocity',f) for p in tp]),
                           v4_adaptive=np.stack([adaptive_forecast(p[-h:],v[-h:],estimate[:f],v4.metadata['gate_thresholds'][f'{h}:{f}']) for p,v,estimate in zip(tp,tv,old)]))
            profiles[f'{h}:{f}']={name:metric_table(pred,tt[:,:f],tq[:,:f],test_people) for name,pred in estimates.items()}
        if h==40:predictions_to_save=dict(positions=tp,visibility=tv,audio_features=ta,target=tt,target_visibility=tq,audio_fusion=new,v4_raw=old,people=np.array(test_people),anchors=np.array([a['anchor'] for a in anchors]))
        print(json.dumps(dict(evaluated_history=h/20,metrics={k:v['metrics'] for k,v in profiles[f'{h}:40'].items()})),flush=True)
    np.savez_compressed(OUT/'heldout_predictions.npz',**predictions_to_save)
    report=dict(metadata=metadata,training=dict(audio=audio_run,pose_control=pose_run),profiles=profiles,development_test_anchors=anchors,elapsed_seconds=time.perf_counter()-start,
                note='Errors in shoulder-width units, lower is better. Display amplification is not a forecast accuracy improvement. Test people already inspected in earlier project iterations.')
    (OUT/'evaluation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps(dict(done=True,elapsed=report['elapsed_seconds'])),flush=True)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--epochs',type=int,default=24)
    parser.add_argument('--output',type=Path,default=OUT,help='Use a new directory to preserve the completed experiment')
    args=parser.parse_args();OUT=args.output.resolve();main(args.epochs)
