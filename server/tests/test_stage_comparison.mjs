import assert from 'node:assert/strict';
import {wristComparison,comparisonViewports} from '../static/stage-comparison.js';

const p=[[0,.6,0],[.5,0,0],[-.5,0,0],[.5,-.8,0],[-.5,-.8,0],[.5,-1.6,0],[-.5,-1.6,0],[.4,-1.5,0],[-.4,-1.5,0]];
const last=p.map(x=>x.slice());last[5]=[.8,-1.2,0];last[6]=[-.5,-1.6,.25];
const quality=Array(9).fill(1),future=Array.from({length:40},()=>last.map(x=>x.slice())),original=JSON.stringify({p,future,quality});
const result=wristComparison(p,future,quality);
assert.ok(Math.abs(result[0].distance-.5)<1e-9);
assert.equal(result[0].direction,'上抬');assert.ok(result[0].elbowChange<0);
assert.equal(result[1].distance,.25);assert.equal(result[1].direction,'向前移动');
assert.deepEqual(wristComparison(p,[p],quality).map(x=>x.distance),[0,0]);
const hidden=quality.slice();hidden[3]=0;assert.equal(wristComparison(p,future,hidden)[0].valid,false);
assert.equal(wristComparison(null,[],quality)[0].valid,false);
assert.equal(JSON.stringify({p,future,quality}),original,'Display must not amplify or change the predicted coordinates.');
for(const [w,h] of [[600,330],[340,500]]){
  const panes=comparisonViewports(w,h);assert.equal(panes.reduce((sum,p)=>sum+p.width*p.height,0),w*h);
  assert.equal(panes[0].width/panes[0].height,panes[1].width/panes[1].height,'Equal camera framing.');
  if(w<520)assert.ok(panes[0].y>panes[1].y,'Current view above predicted view.');
  else assert.ok(panes[0].x<panes[1].x,'Current view left of predicted view.');
}
console.log('Passed: unscaled 3D displacement, direction, elbow change, visibility, immutable inputs, current/future panel order and equal framing.');
