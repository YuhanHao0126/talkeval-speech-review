import {CoachView,clock} from '/talkeval-speech-review/static/stage-coach.js?v=21';
import {SlideRail} from '/talkeval-speech-review/static/stage-slides.js?v=23';
import {StableCueGate} from '/talkeval-speech-review/static/stable-cue.js?v=18';
import {MotionContinuity} from '/talkeval-speech-review/static/motion-continuity.js?v=20';
import {RecordingLayout} from '/talkeval-speech-review/static/recording-layout.js?v=23';
import {audioCondition,trendTrajectory} from '/talkeval-speech-review/static/motion-trend.js?v=14';
import {motionGuidance} from '/talkeval-speech-review/static/motion-guidance.js?v=8';

const E=window.StageEngine;
import {pagesJson as json,openPresenter,publish} from './pages-runtime.js?v=20261118';
let relay=null,active=null;

class UnifiedStage {
  constructor(monitor,kind) {
    this.monitor=monitor;this.kind=kind;this.video=kind==='replay'?monitor.video:document.querySelector('#coach-video');
    this.caseId=kind==='replay'?monitor.data.case_id:'camera';this.generation=0;this.closed=false;this.motion={ready:false,message:'正在准备本场动作观察。'};
    this.continuity=new MotionContinuity();
    this.cueGate=new StableCueGate({hold:6,settle:1.2,refresh:8});this.contentGate=new StableCueGate({hold:8,settle:1.5,refresh:8});this.visibleClock=0;this.lastWall=performance.now();
    const host=document.createElement('section');monitor.host.prepend(host);
    this.view=new CoachView(host,{onSettings:settings=>{if(this.kind==='replay'){const url=new URL(location.href);for(const name of ['history','horizon','method','display','strength','audio'])url.searchParams.set(name,settings[name]);history.replaceState(null,'',url);}const key=settings.history+':'+settings.horizon+':'+settings.method;if(key!==this.timingKey){this.timingKey=key;this.reset({keepPose:true,keepTracker:true});}else this.display();},onPresenter:openPresenter});
    this.timingKey=this.view.settings().history+':'+this.view.settings().horizon+':'+this.view.settings().method;
    const details=document.createElement('details');details.className='v9-original-analysis';details.innerHTML='<summary>详细复盘与人工确认</summary>';
    for(const el of [...monitor.host.children])if(el!==host)details.append(el);
    details.append(monitor.details);
    monitor.host.append(details);
    const left=kind==='replay'?this.video.closest('.lm-screen'):this.video.closest('.coach-left');
    const slideHost=document.createElement('section');
    if(kind==='replay')this.video.closest('.video-panel').after(slideHost);else left.append(slideHost);
    if(kind==='replay'){
      const panel=this.video.closest('.video-panel');
      const evidence=document.createElement('details');evidence.className='v9-playback-evidence';evidence.innerHTML='<summary>表达时间轴与观点定位</summary>';
      for(const selector of ['.playback-progress','.timeline-panel','.chapter-strip']){const el=panel.querySelector(selector);if(el)evidence.append(el);}
      slideHost.after(evidence);
      const report=document.querySelector('#detail-column>.insight-panel');
      if(report){const archive=document.createElement('details');archive.className='v9-report-archive';archive.innerHTML='<summary>图解笔记与完整转写</summary>';report.before(archive);archive.append(report);}
    }
    this.slides=new SlideRail(slideHost,{caseId:this.caseId,visual:monitor.visual,time:()=>this.time(),seek:t=>{this.video.currentTime=t;},source:kind==='camera'?'live':'replay',getContext:()=>this.slideContext()});
    this.slideHost=slideHost;this.abort=new AbortController();
    this.video.addEventListener('seeking',()=>this.reset(),{signal:this.abort.signal});
    if(kind==='replay')for(const event of ['play','timeupdate','seeking','seeked','loadedmetadata','ended'])this.video.addEventListener(event,()=>{
      this.slides.update();
    },{signal:this.abort.signal});
    if(kind==='replay')this.addExampleButton();
    if(kind==='replay'){
      const frame=monitor.host.closest('.lm-frame'),button=document.createElement('button');button.className='v9-nav-button';button.textContent='全屏展示';
      button.onclick=()=>document.fullscreenElement?document.exitFullscreen():frame.requestFullscreen();frame.querySelector('.lm-source').append(button);
    }
    this.recordingLayout=new RecordingLayout(this);
    this.timer=setInterval(()=>this.tick(),kind==='camera'?100:250);this.tick();
  }
  slideContext(){
    if(this.kind==='replay')return {sessionId:this.caseId,units:E.availableUnits(this.monitor.data,this.time()),active:this.playing()};
    const state=this.monitor.bridge.getState(),session=state.session;
    const source=state.practiceCaseId||state.selectedCase;
    return {sessionId:session?.id||'live-ready',active:!!session,sourceCaseId:source&&source!=='custom'?source:null,speechStatus:state.speechStatus||'',interim:session?state.interimSpeech:null,
      units:(session?.segments||[]).map(s=>({text:s.text,time_span:Array.isArray(s.time_span)?s.time_span:[Math.max(0,s.at-.01),s.at],source:s.source,
        reliability:{text:s.source==='manual'?1:s.asrConfidence??.8}}))};
  }
  time(){return this.kind==='replay'?this.video.currentTime:this.monitor.bridge.elapsed();}
  visible(){return !document.querySelector(this.kind==='replay'?'#review-view':'#live-view').hidden;}
  playing(){return this.kind==='replay'?!this.video.paused&&!this.video.ended:!!this.monitor.bridge.getState().session;}
  async addExampleButton(){
    try{
      const data=await json('/api/stage/segments/'+this.caseId);if(this.closed||!data.segments.length)return;
      const row=this.monitor.host.closest('.lm-frame').querySelector('.lm-run');
      const label=document.createElement('label');label.textContent='动作片段 ';
      const select=document.createElement('select');select.setAttribute('aria-label','跳转到已有动作观测的片段');
      select.innerHTML='<option value="">选择时间</option>'+data.segments.map(s=>`<option value="${Math.min(s.end-.1,s.start+12.2)}">${clock(Math.min(s.end-.1,s.start+12.2))}</option>`).join('');
      select.onchange=()=>{if(select.value)this.video.currentTime=Number(select.value);};label.append(select);row.append(label);
    }catch{}
  }
  reset({keepPose=false,keepTracker=false}={}){
    this.generation++;this.lastRequest=null;this.nextRequestAt=0;this.motionHasLoaded=false;
    this.liveObservation=null;
    if(keepPose)this.motion=this.continuity.hold('参数已改变，正在更新预测。');
    else{this.continuity.reset();this.motion={ready:false,message:'正在读取对应时刻的身体观测。'};}
    this.cueGate.reset();this.contentGate.reset();this.view.practice=null;
    if(this.liveId&&!keepTracker){const id=this.liveId;this.liveId=null;fetch('/api/live/'+id,{method:'DELETE'}).catch(()=>{});}
    this.display();
  }
  async tick(){
    if(this.closed||!this.visible())return;
    active=this;this.slides.update();if(this.recordingLayout?.active)this.recordingLayout.update();const now=performance.now();if(this.playing()&&!document.hidden)this.visibleClock+=Math.min(.6,(now-this.lastWall)/1000);this.lastWall=now;
    const at=this.time(),settings=this.view.settings();
    if(this.kind==='camera'){
      const id=this.monitor.bridge.getState().session?.id;
      if(id!==this.cameraSession){this.cameraSession=id;this.reset();}
    }
    if(this.motion.ready){this.motion.lagSeconds=Math.max(0,at-this.motion.at);if(!this.motion.held&&this.motion.lagSeconds>(this.kind==='camera'?1.5:5))this.motion=this.continuity.hold('正在等待新的可靠画面，暂时保持上一姿态。');}
    this.display();
    const key=`${at.toFixed(2)}:${settings.history}:${settings.horizon}:${settings.method}:${settings.audio}:${settings.display}`;
    if(this.video.readyState<2){if(!this.motion.ready){this.motion.message='正在载入视频画面，画面就绪后开始分析。';this.display();}return;}
    if(this.busy||now<(this.nextRequestAt||0)||(key===this.lastRequest&&this.motion.audio?.status!=='loading'&&this.motion.audio_model_status!=='loading'))return;
    this.busy=true;const generation=this.generation;this.lastRequest=key;
    try{
      const config={model_profile:Number(settings.history)>4||Number(settings.horizon)>3?'extended':'flexible',history_seconds:settings.history,horizon_seconds:settings.horizon,method:settings.method};
      const useAudio=settings.audio==='on'&&settings.display==='trend';
      let [result,audio]=this.kind==='replay'?await Promise.all([
        json('/api/stage/forecast?'+new URLSearchParams({...config,case_id:this.caseId,at})),
        useAudio?json('/api/stage/audio?'+new URLSearchParams({case_id:this.caseId,at,history_seconds:settings.history})).catch(()=>({ready:false,status:'unavailable',message:'音频暂不可用'})):Promise.resolve(null)
      ]):[null,null];
      if(this.closed||generation!==this.generation)return;
      if(!result?.cached && this.playing()){
        // Replay fallback and camera both process the actual current frame. No future read-ahead.
        if(this.kind==='replay'&&this.video.playbackRate!==1){result={ready:false,message:'无缓存片段请使用1倍速，以便连续观察动作。'};}
        else {
          if(!this.liveId){const session=await json('/api/live',{method:'POST'});
            if(this.closed||generation!==this.generation){fetch('/api/live/'+session.id,{method:'DELETE'});return;}this.liveId=session.id;}
          const captureAt=this.time();
          const canvas=this.captureCanvas||=document.createElement('canvas');
          canvas.width=Math.min(640,this.video.videoWidth);canvas.height=Math.round(canvas.width*this.video.videoHeight/this.video.videoWidth);
          canvas.getContext('2d').drawImage(this.video,0,0,canvas.width,canvas.height);
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));
          const form=new FormData();form.append('frame',blob,'frame.jpg');form.append('timestamp_ms',Math.round(captureAt*1000));
          for(const [k,v] of Object.entries(config))form.append(k,k==='method'&&v==='audio'?'gru':v);
          result=await json('/api/live/'+this.liveId,{method:'POST',body:form});
          if(settings.method==='audio')Object.assign(result,{requested_method:'audio',audio_model_used:false,audio_model_status:'unsupported',audio_model_note:'声音训练版用于已缓存的有声录像；当前画面流使用姿态模型。'});
          result.at??=captureAt;result.source=this.kind==='replay'?'当前录像画面 · 本机实时识别':'摄像头画面 · 本机实时识别';
        }
      }
      if(this.closed||generation!==this.generation)return;
      if((result?.ready||result?.observed_ready)&&Math.abs(this.time()-result.at)>(this.kind==='camera'?1.5:5))result={ready:false,message:'本次分析结果已过时，保持上一姿态并重新采集画面。'};
      // Reuse actual observations for the legacy live gesture panel, never a held display pose.
      if(this.kind==='camera')this.liveObservation=result?.observed_ready?{at:result.at,...result.observation}:null;
      if(result?.ready){
        if(!this.motionHasLoaded){this.cueGate.reset();this.motionHasLoaded=true;}
        if(this.kind==='camera'&&useAudio)audio={ready:true,samples:this.monitor.bridge.getState().analysisAudio||[],source:'本机麦克风能量'};
        const next={...result,current:result.history.at(-1),visibility:result.visibility.at(-1),future:result.positions,audio,forecastReady:true,live:this.kind==='camera'||!result.cached,lagSeconds:Math.max(0,this.time()-result.at)};
        this.motion=this.continuity.accept(next,{recoverySamples:result.cached?1:2});
        this.presentationKey=null;delete this.motion.history;delete this.motion.positions;delete this.motion.image_points;
      }else if(result?.observed_ready&&result.observation){
        this.motion=this.continuity.accept({...result,...result.observation,ready:true,forecastReady:false,future:[],live:true,lagSeconds:Math.max(0,this.time()-result.at)},{recoverySamples:2});
        this.presentationKey=null;
      }else this.motion=this.continuity.hold(result?.message||'正在重新识别，暂时保持上一姿态。');
      this.display();
    }catch(error){if(!this.closed&&generation===this.generation){this.liveObservation=null;this.lastRequest=null;this.nextRequestAt=performance.now()+700;if(error.status===404)this.liveId=null;const message=error.name==='TimeoutError'?'动作分析超时，正在重新连接。':'动作观察暂不可用：'+error.message;this.motion=this.continuity.hold(message);this.display();}}
    finally{this.busy=false;}
  }
  snapshot(){
    const r=this.monitor.result,settings=this.view.settings(),at=this.time();
    const aligned=!!r&&Math.abs(r.t-at)<1;
    const review=r?.slow?.review||{},units=r?.units||[],points=r?.beats||[];
    const summary=E.coverageSummary(points),coverage=summary.coverage==null?null:100*summary.coverage;
    const practiceGoal=r?.visualCoach?.code==='visual-emphasis'?'emphasis':r?.visualCoach?.code==='visual-contrast'?'open':'steady';
    const last=units.filter(u=>u.time_span[1]<=at&&u.time_span[1]>at-30&&u.reliability?.text>=.6).slice(-2);
    const slow={coverage,summary,goal:review.goal,missing:review.missing,next:review.nextStep,practiceGoal,
      points:points.map((b,i)=>({title:b.title,label:this.monitor.visual?.beats?.[i]?.note_title||E.shortMeaning(b.title,14),state:b.status,status:E.complete(b)?'已对齐':b.status==='partial'?'部分':b.status==='conflict'?'待核对':'待观察',
        evidence:b.semantic?b.semantic.facets.filter(f=>f.evidence).map(f=>f.evidence.text||'').filter(Boolean).join(' / '):[...new Set(b.claims.map(c=>c.evidence?.trim()).filter(Boolean))].join(' / '),
        missing:b.semantic?b.semantic.facets.filter(f=>f.state!=='supported').map(f=>f.claim).join('；'):b.claims.filter(c=>!c.matched).map(c=>c.text+(c.guard?`（${c.guard}）`:'')).join('；')})),
      evidence:last.length?last.map(u=>`${clock(u.time_span[0])}–${clock(u.time_span[1])} “${u.text}”`).join(' '):'近30秒暂无已结束的可靠语句。',
      semantic:this.monitor.host.querySelector('[data-out="semantic"]')?.textContent||'文字对齐参考',
      provenance:this.kind==='camera'?'按本场提纲核对实时转写。':this.monitor.data.metadata?.can_evaluate_original_intent===false?'案例重点来自参考文稿或转写，只演示对齐流程，不代表原演讲者事前目标。':'按本场提纲核对已播放到的语句。'};
    const contentCandidate=r?.contentCue||{code:'content-wait',title:review.goal?'按重点往下讲':'等待本场重点',reason:review.missing||review.nextStep||'播放后按已结束的语句核对内容。',priority:0,severity:0};
    slow.cue=aligned?this.contentGate.show(contentCandidate,at,this.visibleClock):(this.contentGate.current||{title:'正在同步内容',reason:'按当前播放时刻读取语句。'});
    if(this.kind==='replay'&&this.video.ended&&aligned){
      const remaining=points.filter(b=>!E.complete(b));
      slow.cue={code:'content-finished',title:summary.total&&remaining.length===0?'本场要点已覆盖':'演讲结束 · 查看未确认要点',
        reason:summary.total?(remaining.length?`已对齐 ${summary.done}/${summary.total} 项；待核对「${E.shortMeaning(remaining[0].title,22)}」${remaining.length>1?`等 ${remaining.length} 项`:''}。可在详细复盘中核对原话。`:`${summary.total} 个要点均有对应原话或人工确认。覆盖率表示要点完成情况，不代表演讲质量评分。`):'本场尚未设置提纲，暂不计算要点覆盖率。',priority:0,severity:0};
    }
    let cue=r?.deliveryCue?{...r.deliveryCue}:{code:'waiting',title:'等待开始',reason:'播放录像或开始演讲后观察动作与节奏。',priority:0,severity:0};
    if(this.motion.ready&&!this.motion.held&&this.motion.forecastReady!==false){
      if(cue.code==='waiting')cue={...cue,code:'motion-observing',title:'动作预测已就绪',reason:'按当前内容自然表达；语速提示会在完整语句积累后给出。'};
      this.motion.guidance=motionGuidance(this.motion.current,this.motion.future,this.motion.visibility,settings.goal==='auto'?practiceGoal:settings.goal,Number(settings.horizon));
      const signature=[this.motion.at,settings.display,settings.strength,settings.audio,this.motion.audio?.status,this.motion.audio?.input_end].join(':');
      if(signature!==this.presentationKey){
        this.presentationKey=signature;
        const sound=settings.audio==='on'?audioCondition(this.motion.audio?.samples,this.motion.at,Number(settings.history)):null;
        this.motion.presentation=settings.display==='trend'?{...trendTrajectory(this.motion.current,this.motion.future,this.motion.visibility,{strength:settings.strength,audio:sound}),sound}:null;
        // Live microphone history is short-lived. Relay only the summarized signal.
      }
      if(Number(settings.horizon)<=3&&this.motion.guidance.level==='attention'&&(cue.priority||0)<60)cue={code:'motion-'+this.motion.guidance.evaluation,title:this.motion.guidance.evaluation,reason:this.motion.guidance.suggestion,priority:60,severity:1,source:'快通道 · 动作趋势'};
    }
    if(this.motion.held)cue={code:'tracking-hold',title:'保持上一姿态',reason:'正在重新识别人物；当前姿态和残影暂停更新。',priority:20,severity:0};
    else if(this.motion.ready&&this.motion.forecastReady===false)cue={code:'tracking-warmup',title:'已识别到当前姿态',reason:'正在积累连续观察，稍后开始预测。',priority:0,severity:0};
    cue={...(aligned?this.cueGate.show(cue,at,this.visibleClock):(this.cueGate.current||{title:'正在同步画面',reason:'按当前播放时刻读取动作与声音。'})),source:'快通道 · 动作与节奏'};
    const motion={...this.motion};if(motion.audio)motion.audio={...motion.audio,samples:undefined};
    return {version:9,uiVersion:23,caseId:this.kind==='camera'?'camera-'+(this.cameraSession||'waiting'):this.caseId,title:this.monitor.data.intent_map?.title||'现场演讲',at,playing:this.playing(),settings,slow,cue,motion};
  }
  display(){const state=this.snapshot();this.state=state;this.view.render(state);publish(state);}
  dispose(){this.closed=true;clearInterval(this.timer);this.abort.abort();this.generation++;if(this.liveId)fetch('/api/live/'+this.liveId,{method:'DELETE'}).catch(()=>{});this.recordingLayout.dispose();this.view.dispose();this.slideHost.remove();}
}

let replayStage=null,cameraStage=null;
function attach(){
  const replay=window.TalkEvalLaunch?.getReplayMonitor(),camera=window.TalkEvalLaunch?.getCameraMonitor();
  if(replayStage?.monitor!==replay){replayStage?.dispose();replayStage=replay?new UnifiedStage(replay,'replay'):null;}
  if(camera&&!cameraStage)cameraStage=new UnifiedStage(camera,'camera');
  if(replayStage)window.TalkEvalBoot?.ready();
}
setInterval(attach,300);attach();
const top=document.querySelector('.topbar-actions');
const library=document.createElement('button');library.className='v9-nav-button';library.textContent='展开案例库';
library.onclick=()=>{const open=document.body.classList.toggle('v9-library-open');library.textContent=open?'收起案例库':'展开案例库';};top.prepend(library);
const lab=document.createElement('a');lab.className='v9-lab-link';lab.href='./about.html';lab.target='_blank';lab.textContent='网页版说明 ↗';top.append(lab);
document.body.classList.add('v9-integrated');
window.TalkEvalIntegration={getState:()=>active?.state,getReplay:()=>replayStage,getCamera:()=>cameraStage,getRelay:()=>relay,openPresenter};
window.addEventListener('beforeunload',()=>{replayStage?.dispose();cameraStage?.dispose();});
