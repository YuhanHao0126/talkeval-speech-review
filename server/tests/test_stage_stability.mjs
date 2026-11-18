import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {StableCueGate} from '../static/stable-cue.js';

const cue=(code,reason=code,priority=20)=>({code,title:code,reason,priority,severity:1});
const coachSource=fs.readFileSync(new URL('../static/stage-coach.js',import.meta.url),'utf8');
assert.ok(!coachSource.includes('data-out='),'Integrated coach outputs must not match legacy monitor selectors');
assert.ok(coachSource.includes('data-coach-out="reason"'));
const gate=new StableCueGate();
assert.equal(gate.show(cue('pace','第一句话'),0,0).reason,'第一句话');
for(let n=1;n<32;n++)assert.equal(gate.show(cue('pace',`不断变化的数字${n}`),n/4,n/4).reason,'第一句话');
assert.equal(gate.show(cue('pace','新的完整句子'),8,8).reason,'新的完整句子');
for(let n=33;n<65;n++)assert.equal(gate.show(cue(n%2?'motion':'pace'),n/4,n/4).code,'pace');
gate.show(cue('motion'),17,17);
assert.equal(gate.show(cue('motion'),18.25,18.25).code,'motion');
for(let n=0;n<20;n++)assert.equal(gate.show(cue('different'),18.25,18.25).code,'motion');
assert.equal(gate.show(cue('seek-reset'),2,18.25).code,'seek-reset');
gate.show(cue('deadline','现在收尾',100),2.1,18.35);
assert.equal(gate.show(cue('deadline','现在收尾',100),2.4,18.65).code,'deadline');
const slowGate=new StableCueGate({hold:8});
assert.equal(slowGate.show(cue('content-point-1'),0,0).code,'content-point-1');
assert.equal(gate.current.code,'deadline');

// Reproduce the actual failed GLB load: retrying the same selected character must work.
let attempts=0;
const statuses=[];
const source=fs.readFileSync(new URL('../static/stage-avatar.js',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace('export class StageAvatar','class StageAvatar');
const context=vm.createContext({loadSpeakerAvatars:async()=>{attempts++;if(attempts===1)throw Error('asset connection failed');return {ghosts:[]};}});
vm.runInContext(source+'\nglobalThis.Avatar=StageAvatar;',context);
const avatar=Object.create(context.Avatar.prototype);
Object.assign(avatar,{scene:{},loadState:'idle',character:'',onStatus:s=>statuses.push(s.state)});
await assert.rejects(avatar.changeCharacter('male'));
assert.equal(avatar.loadState,'error');
await avatar.changeCharacter('male');assert.equal(attempts,1);
await avatar.changeCharacter('male',{retry:true});
assert.equal(attempts,2);assert.equal(avatar.loadState,'ready');assert.equal(avatar.character,'male');
assert.deepEqual(statuses,['loading','error','loading','ready']);

const engine=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../original-site/stage-engine.js',import.meta.url),'utf8'),engine);
const data=JSON.parse(fs.readFileSync(new URL('../original-site/data/cases/speech_004_whales.json',import.meta.url)));
const plan=engine.StageEngine.defaultPlan(data);
for(const at of [30,300,789.216,800]){
  const result=engine.StageEngine.evaluate(data,at,plan,1000);
  assert.ok(result.deliveryCue);
  assert.ok(!result.deliveryCue.code.startsWith('content'));
  assert.ok('contentCue' in result);
}
console.log('PASS: readable cue holds, independent channels, paused/seek/urgent cases, failed model retry, separated engine outputs');
