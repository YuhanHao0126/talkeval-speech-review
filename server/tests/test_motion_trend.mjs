import assert from 'node:assert/strict';
import {audioCondition,trendTrajectory} from '../static/motion-trend.js';
const p=[[0,.6,0],[.5,0,0],[-.5,0,0],[.5,-.8,0],[-.5,-.8,0],[.5,-1.6,0],[-.5,-1.6,0],[.4,-1.5,0],[-.4,-1.5,0]];
const q=Array(9).fill(1),f=Array.from({length:60},(_,i)=>p.map((v,j)=>v.map((x,k)=>x+(j===5&&k===0?.15*(i+1)/60:0))));
const before=JSON.stringify({p,f,q}),a=trendTrajectory(p,f,q,{strength:4}),b=trendTrajectory(p,f,q,{strength:4});
assert.deepEqual(a,b,'Identical inputs must produce identical trajectories.');
assert.equal(JSON.stringify({p,f,q}),before,'Never mutate model data.');
const norm=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
assert.ok(norm(p[5],a.positions.at(-1)[5])>norm(p[5],f.at(-1)[5])*2);
let last=0;
for(const frame of a.positions){
  assert.deepEqual(frame[0],p[0]);assert.deepEqual(frame[1],p[1]);
  for(const [s,e,w] of [[1,3,5],[2,4,6]]){
    assert.ok(Math.abs(norm(frame[s],frame[e])-norm(p[s],p[e]))<1e-9);
    assert.ok(Math.abs(norm(frame[e],frame[w])-norm(p[e],p[w]))<1e-9);
  }
  const d=norm(frame[5],p[5]);assert.ok(d>=last-1e-9,'No random swings along the trajectory.');last=d;
}
const hidden=q.slice();hidden[3]=0;
assert.ok(trendTrajectory(p,f,hidden).positions.every(frame=>JSON.stringify(frame[5])===JSON.stringify(p[5])));
const stationary=trendTrajectory(p,Array(60).fill(p),q,{strength:6});
assert.ok(stationary.positions.every(frame=>norm(frame[5],p[5])<1e-9),'Do not manufacture movement from no trend.');
const samples=Array.from({length:40},(_,i)=>({at:(i+1)/20,rms:i<33?.04:.09}));
const sound=audioCondition(samples,2,2),silence=audioCondition(samples.map(s=>({...s,rms:0})),2,2);
assert.ok(sound.ready&&sound.gain>1&&silence.gain<1);
assert.deepEqual(audioCondition([...samples,{at:2.01,rms:999}],2,2),sound,'Future audio cannot affect the features.');
assert.equal(audioCondition(samples,4,2).ready,false,'Stale audio must be ignored.');
const withAudio=trendTrajectory(p,f,q,{strength:4,audio:sound});
assert.ok(norm(withAudio.positions.at(-1)[5],p[5])>norm(a.positions.at(-1)[5],p[5]));
assert.deepEqual(trendTrajectory(p,f,q,{strength:4,audio:{ready:false,gain:8}}),a,'Missing audio must fall back exactly.');
const extreme=f.map(frame=>{const c=frame.map(v=>v.slice());c[5]=[1.3,-.8,0];return c;});
const capped=trendTrajectory(p,extreme,q,{strength:6,audio:sound}).positions.at(-1);
const d=capped[5].map((x,i)=>x-capped[3][i]);
assert.ok(Math.acos(-d[1]/Math.hypot(...d))<=65*Math.PI/180+1e-9);
console.log('Passed: deterministic amplification, immutable forecasts, fixed bones, causal audio, silence/fallback, smooth paths, angle limits.');
