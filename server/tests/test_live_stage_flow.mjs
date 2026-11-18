import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {MotionContinuity} from '../static/motion-continuity.js';

// Exercise production request/state orchestration with deterministic camera responses.
const source=fs.readFileSync(new URL('../original-site/integration.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('class UnifiedStage'),source.indexOf('let replayStage'));
let result,clock=0,created=0;
const bridge={getState:()=>({session:{id:'test-camera'}})};
const context=vm.createContext({active:null,performance:{now:()=>clock*1000},FormData,Blob,
 document:{hidden:false,createElement:()=>({getContext:()=>({drawImage(){}}),toBlob:fn=>fn(new Blob(['frame']))})},
 json:async url=>{if(url==='/api/live'){created++;return {id:'server-camera'};}if(result instanceof Error)throw result;return result;}});
vm.runInContext(code+'\nglobalThis.Stage=UnifiedStage;',context);
const stage=Object.create(context.Stage.prototype);
Object.assign(stage,{kind:'camera',cameraSession:'test-camera',monitor:{bridge},video:{readyState:4,videoWidth:640,videoHeight:360},
 generation:0,lastWall:0,visibleClock:0,slides:{update(){}},continuity:new MotionContinuity(),motion:{ready:false},
 view:{settings:()=>({history:'2',horizon:'3',method:'gru',display:'raw',audio:'off'})},
 cueGate:{reset(){}},contentGate:{reset(){}},time:()=>clock,visible:()=>true,playing:()=>true,display(){this.rendered=this.motion;}});
const points=Array.from({length:9},(_,i)=>[i/10,0,0]),visibility=Array(9).fill(1);
const observation={current:points,visibility,detail:{positions:Array(33).fill([0,0,0]),visibility:Array(33).fill(1)},image_points:Array(33).fill([.5,.5])};
const good=at=>({at,ready:true,observed_ready:true,observation,history:[points],visibility:[visibility],positions:[points]});
async function tick(at,response){clock=at;result=response;await stage.tick();return stage.rendered;}
let shown=await tick(0,{at:0,ready:false,observed_ready:true,observation});
assert.ok(shown.ready&&!shown.forecastReady,'Warmup should show the current person immediately');
assert.equal(created,1);
shown=await tick(2,good(2)); // A long delay is detected, requiring a second reliable observation.
shown=await tick(2.1,good(2.1));
assert.ok(shown.ready&&shown.forecastReady&&!shown.held);
shown=await tick(2.2,{at:2.2,ready:false,observed_ready:false,message:'occluded'});
assert.ok(shown.ready&&shown.held);assert.equal(shown.at,2.1);assert.equal(stage.liveObservation,null);
shown=await tick(2.3,good(2.3));assert.ok(shown.held);assert.equal(shown.at,2.1);
shown=await tick(2.4,good(2.4));assert.ok(shown.recovered&&!shown.held);
stage.reset({keepPose:true,keepTracker:true});
assert.ok(stage.motion.held);assert.equal(stage.liveId,'server-camera','Changing windows keeps the camera tracker');
await tick(2.5,good(2.5));shown=await tick(2.6,good(2.6));assert.ok(!shown.held);assert.equal(created,1);
shown=await tick(5,good(3));assert.ok(shown.held);assert.equal(shown.at,2.6,'An old network response must not become a fresh pose');
const missing=new Error('session expired');missing.status=404;
shown=await tick(5.1,missing);assert.ok(shown.ready&&shown.held);assert.equal(stage.liveId,null);
await tick(6,good(6));shown=await tick(6.1,good(6.1));assert.ok(!shown.held);assert.equal(created,2);
console.log('PASS: live orchestration warmup, hold/recovery, window changes, stale replies, session recreation');
