import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the production live detector with instrumented model calls.
const source=fs.readFileSync(new URL('../original-site/live.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('  function detectLiveFrame('),source.indexOf('  function runVisionLoop('));
let calls=0,now=1;
const stage={liveObservation:{at:.8,image_points:Array.from({length:33},()=>[.5,.5]),detail:{visibility:Array(33).fill(1)}}};
const state={poseTask:{detect(){calls++;return {landmarks:[]};}},faceTask:null};
const context=vm.createContext({state,window:{TalkEvalIntegration:{getCamera:()=>stage}},elapsed:()=>now,
  document:{createElement:()=>({getContext:()=>({drawImage(){}})})}});
vm.runInContext(body+'\nglobalThis.detect=detectLiveFrame;',context);
const video={videoWidth:640,videoHeight:360};
assert.equal(context.detect(video).pose.landmarks[0].length,33);
assert.equal(calls,0,'Integrated mode must not run a second pose detector on the animation thread');
now=2;
assert.equal(context.detect(video).pose.landmarks.length,0,'Stale display poses are not new observations');
stage.liveObservation=null;
assert.equal(context.detect(video).pose.landmarks.length,0,'Tracking loss clears gesture measurements');
assert.equal(calls,0,'Missing observation must not trigger expensive duplicate crop retries');
console.log('PASS: shared real landmarks, no duplicate body inference, no stale pose measurement, face model optional');
