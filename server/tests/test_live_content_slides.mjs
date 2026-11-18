import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ContentSlideFollower,rankSlides} from '../static/content-slides.js';
import {presentationPresets} from '../static/presentation-presets.js';
import {deckTextCatalog} from '../static/deck-text-catalog.js';
const root=new URL('../',import.meta.url),pages=presentationPresets['recording_import-poisson-20261106-demo'].pages;
const recorded=JSON.parse(fs.readFileSync(new URL('data/stage-sessions/import-poisson-20261106-demo/session.json',root)));
const units=recorded.segments.map(s=>({text:s.text,time_span:s.time_span,source:'browser-asr',reliability:{text:1}}));
const run=(deck,input)=>{const f=new ContentSlideFollower();return input.map((u,i)=>f.update(deck,input.slice(0,i+1),{at:u.time_span[1],sessionId:'speech'}).index);};
const expected=[0,0,1,1,1,2,2,2,2,3,3,4,4,4,4,4];
assert.deepEqual(run(pages,units),expected);
const shifted=units.map(u=>({...u,time_span:u.time_span.map(t=>t+300)}));
assert.deepEqual(run(pages.map(p=>({...p,start:99999})),shifted),expected,'Content following never consults pre-set slide timestamps');
let f=new ContentSlideFollower();
assert.equal(f.update(pages,units,{at:19,sessionId:'a'}).index,0,'No future phrase is visible');
assert.equal(f.update(pages,units,{at:40,sessionId:'a'}).index,2);
assert.equal(f.update(pages,units,{at:15,sessionId:'a'}).index,0,'Rewind discards later matches');
assert.equal(f.update(pages,[],{at:10000,sessionId:'new-session'}).index,0,'Silence and elapsed time cannot advance a slide');
const utterance=(text,end,confidence=1)=>({text,time_span:[end-1,end],source:'browser-asr',reliability:{text:confidence}});
assert.equal(f.update(pages,[utterance('大多数时间都处在等待中',5,.2)],{at:8}).index,0,'Low-confidence text does not turn pages');
assert.equal(f.update(pages,[utterance('稍后我们再讲机遇到来，果断出击',5)],{at:8}).index,0,'Future announcements do not turn pages');
assert.equal(f.update(pages,[utterance('机遇',6)],{at:8}).index,0,'Shared short words are insufficient');
assert.equal(f.update(pages,[utterance('现在机遇到来，我们要果断出击',7)],{at:8}).index,3,'Strong content can skip pages');
assert.equal(f.update(pages,[],{at:9,sessionId:'reset'}).index,0);
const ambiguous=[{title:'共同标题',text:'共同标题\n甲的特征描述'},{title:'共同标题',text:'共同标题\n乙的特征描述'}];
assert.equal(rankSlides(ambiguous,'共同标题')[0].score,0,'Repeated boilerplate cannot determine a page');
const extracted=Object.entries(deckTextCatalog).filter(([url])=>url.includes('/3516eb470d022f098bf4570eb90241ed/')).map(([url,p])=>({...p,url}));
assert.equal(extracted.length,5);
assert.equal(run(extracted,units).at(-1),4,'PPTX text works without hand-authored trigger aliases');

// Connect the real browser-ASR result handler to the real live slide-context adapter.
const source=fs.readFileSync(new URL('original-site/live.js',root),'utf8');
const speechCode=source.slice(source.indexOf('  function getSpeechRecognition'),source.indexOf('  function addSegment'));
let now=1;
const live={session:{id:'asr-pipeline',segments:[]},practiceCaseId:'recording_import-poisson-20261106-demo',speechOn:false,stopping:false};
class Recognition{start(){this.starts=(this.starts||0)+1;}stop(){}}
const ctx=vm.createContext({state:live,window:{SpeechRecognition:Recognition},$:()=>({value:'zh-CN'}),setText(){},elapsed:()=>now,transcriptText:()=>'',clearTimeout(){},setTimeout:()=>1,
  addSegment:(text,source,confidence)=>live.session.segments.push({text,source,asrConfidence:confidence,at:now})});
vm.runInContext(speechCode+'\nstartSpeechRecognition();',ctx);
const integration=fs.readFileSync(new URL('original-site/integration.js',root),'utf8');
vm.runInContext(integration.slice(integration.indexOf('class UnifiedStage'),integration.indexOf('let replayStage'))+'\nthis.Stage=UnifiedStage;',ctx);
const stage=Object.create(ctx.Stage.prototype);Object.assign(stage,{kind:'camera',time:()=>now,monitor:{bridge:{getState:()=>live}}});
function event(text,isFinal=true){const item=[{transcript:text,confidence:.9}];item.isFinal=isFinal;return {resultIndex:0,results:[item]};}
f=new ContentSlideFollower();live.speech.onresult(event('大多数时间都处在等待中',false));
assert.equal(live.session.segments.length,0,'Interim recognition does not enter the completed-text stream');
assert.equal(live.interimSpeech,null,'A first unstable recognition result cannot turn a page');
now=1.7;live.speech.onresult(event('大多数时间都处在等待中，我们需要做好准备',false));
let interimInput=stage.slideContext();assert.equal(interimInput.interim.stable,true);
assert.equal(f.update(pages,interimInput.units,{at:now,sessionId:interimInput.sessionId,interim:interimInput.interim}).index,1,'Stable interim text can turn the PPT before a long final paragraph arrives');
assert.equal(live.session.segments.length,0,'Stable interim text is not stored as final evidence or used by slow-channel coverage');
const untouched=new ContentSlideFollower();assert.equal(untouched.update(pages,[],{at:9,interim:interimInput.interim}).index,0,'Expired interim text is not newly applied');
now=7;live.speech.onresult(event('大多数时间都处在等待中'));
let input=stage.slideContext();assert.equal(input.sourceCaseId,'recording_import-poisson-20261106-demo');
assert.equal(f.update(pages,input.units,{at:now,sessionId:input.sessionId}).index,1);
now=30;input=stage.slideContext();assert.equal(f.update(pages,input.units,{at:now,sessionId:input.sessionId}).index,1,'A long pause keeps the same page');
live.speech.onresult(event('我们在独处中打磨自己，在坚持中完善自我'));input=stage.slideContext();
assert.equal(f.update(pages,input.units,{at:now,sessionId:input.sessionId}).index,2);
assert.ok(live.speechStatus.includes('完整语句'));
// Real, locally saved live-ASR paragraphs can cover several slides at once.
const paragraphResults=[];
for(const id of ['live-d7eec9ca-eda3-47ad-a92d-a17bf3e0c82e','live-1b0c10ba-6863-4d19-87c3-8f3b19c38507']){
  const path=new URL('data/stage-sessions/'+id+'/session.json',root);if(!fs.existsSync(path))continue;
  const saved=JSON.parse(fs.readFileSync(path)),follower=new ContentSlideFollower(),past=[],observed=[];
  for(const segment of saved.segments){past.push({text:segment.text,time_span:segment.time_span||[segment.at-.01,segment.at],source:segment.source,reliability:{text:segment.asrConfidence??.8}});observed.push({at:segment.at,page:follower.update(pages,past,{at:segment.at,sessionId:id}).index+1});}
  assert.equal(observed.at(-1).page,5,'The latest topic wins in multi-topic final paragraphs');paragraphResults.push({id,observed});
}
const evidence=new URL('artifacts/live-content-slides-v23/',root);if(fs.existsSync(evidence))fs.writeFileSync(new URL('content-checks.json',evidence),JSON.stringify({recordingCasePages:expected.map(x=>x+1),arbitrarySlideTimesPassed:true,stableInterimSeconds:.6,interimDoesNotEnterSlowEvidence:true,liveParagraphs:paragraphResults,physicalMicrophoneTest:false},null,2));
console.log('PASS: content pages, timing independence, causality, ambiguity, PPTX text, stable interim ASR, final-event pipeline, long live-ASR paragraphs and new-session reset.');
