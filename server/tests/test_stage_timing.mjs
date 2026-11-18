import assert from 'node:assert/strict';
import {PoseTransition,framePoses,forecastTiming} from '../static/stage-motion.js';
const pose=x=>Array.from({length:9},()=>[x,0,0]);
const make=(at=10,n=40)=>({current:pose(at),future:Array.from({length:n},(_,i)=>pose(at+(i+1)/20)),at,key:String(at)+':'+n,stream:'case:2:'+n});
for(const n of [10,20,30,40,60,100,200]){
  const frame=make(10,n),p=framePoses(frame),t=forecastTiming(frame);
  assert.equal(t.target,10+n/20);
  assert.deepEqual(p.ghosts.at(-1),frame.future.at(-1));
  assert.ok(Math.abs(p.ghosts[0][0][0]-(10+n/20/3))<1e-10);
  assert.ok(Math.abs(p.ghosts[1][0][0]-(10+n/20*2/3))<1e-10);
}
const tr=new PoseTransition(),a=make(),raw=JSON.stringify(a);
tr.setFrame(a,0);tr.setFrame(make(10.25),250);
const mid=tr.sample(375);assert.ok(mid.current[0][0]>10&&mid.current[0][0]<10.25);
// Retarget from what is actually on screen, including trails, not previous raw output.
tr.setFrame(make(10.5),375);
assert.deepEqual(tr.sample(375).current,mid.current);
assert.deepEqual(tr.sample(375).ghosts,mid.ghosts);
assert.equal(tr.sample(1000).settled,true);
assert.deepEqual(tr.sample(1000).ghosts.at(-1),make(10.5).future.at(-1));
assert.equal(tr.setFrame(make(10.5),1001),false);
tr.setFrame(make(3),1002);assert.deepEqual(tr.sample(1002).current,pose(3));
tr.setFrame(null,1003);assert.equal(tr.sample(1003),null);
tr.setFrame(make(10,60),1004);assert.equal(tr.sample(1004).ghosts[2][0][0],13);
assert.equal(JSON.stringify(a),raw);
console.log('Passed: 7 horizons including 10 seconds, exact ghost timing, continuous retarget, pause endpoint, seek/reset, immutable forecasts.');
