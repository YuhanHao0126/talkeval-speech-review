import {StageAvatar} from './stage-avatar.js?v=19';
import {forecastTiming} from './stage-motion.js?v=19';
import {practiceTrajectory} from './motion-guidance.js?v=8';

export const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const clock=t=>`${String(Math.floor(Math.max(0,t)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,t)%60)).padStart(2,'0')}`;
const preciseClock=t=>`${String(Math.floor(Math.max(0,t)/60)).padStart(2,'0')}:${(Math.max(0,t)%60).toFixed(2).padStart(5,'0')}`;
export class CoachView {
  constructor(host,{presenter=false,onSettings=()=>{},onPresenter=()=>{}}={}) {
    this.host=host;this.presenter=presenter;this.onSettings=onSettings;
    host.classList.add('v9-coach','v16-clean');
    host.innerHTML=`<div class="v9-coach-head"><span><i></i> 快慢通道 · 演讲提词器</span><button data-ui="presenter">打开演讲者视图 ↗</button></div>
      <section class="v9-priority" aria-label="快通道提示"><div><span data-coach-out="source">快通道 · 动作与节奏</span><time data-coach-out="time">00:00</time></div><h2 data-coach-out="cue" aria-live="polite">等待开始</h2><p data-coach-out="reason">观察动作和声音节奏。</p></section>
      <section class="v9-motion"><div class="v9-section-head"><h3>快通道 <span>动作趋势</span></h3><span data-coach-out="motion-status">等待画面</span><button data-ui="motion-fullscreen" aria-label="放大动作残影">放大 ↗</button></div>
        <div class="v17-parameters" aria-label="快通道参数">
          <label>观察过去<select data-setting="history"><option value="2">2秒</option><option value="3">3秒</option><option value="4">4秒</option><option value="5">5秒</option><option value="6">6秒</option><option value="7">7秒</option><option value="8">8秒</option><option value="9">9秒</option><option value="10">10秒</option></select></label>
          <label>预测未来<select data-setting="horizon"><option value="0.5">0.5秒</option><option value="1">1秒</option><option value="1.5">1.5秒</option><option value="2" selected>2秒</option><option value="3">3秒</option><option value="4">4秒 · 探索</option><option value="5">5秒 · 探索</option><option value="6">6秒 · 探索</option><option value="7">7秒 · 探索</option><option value="8">8秒 · 探索</option><option value="9">9秒 · 探索</option><option value="10">10秒 · 探索</option></select></label>
          <label>预测模型<select data-setting="method"><option value="audio">声音＋动作 · 训练版</option><option value="gru" selected>原姿态模型</option><option value="adaptive">稳健预测</option><option value="persistence">保持当前姿态 · 基线</option></select></label>
          <label>显示内容<select data-setting="display"><option value="trend">趋势演示 · 增强</option><option value="raw">原始预测</option></select></label>
          <label>动作增强<select data-setting="strength"><option value="2">2倍 · 温和</option><option value="4" selected>4倍 · 明显</option><option value="6">6倍 · 强</option></select></label>
          <label>展示声音调节<select data-setting="audio"><option value="on">开启</option><option value="off">关闭</option></select></label>
        </div><p class="v17-sync-note" data-ui="sync-note" hidden>参数跟随展示页，请在展示页调整。</p>
        <p class="v16-model-note" data-coach-out="model-note" role="status" hidden></p>
        <div class="v9-avatar" data-layout="overlay" aria-label="当前动作与未来趋势叠影"><div class="v14-overlay-badge" data-coach-out="overlay-badge">趋势演示 · 增强</div><div class="v9-avatar-canvas"></div><div class="v9-avatar-empty" data-coach-out="avatar-empty" role="status">正在载入3D人物…</div><button class="v18-avatar-retry" data-ui="avatar-retry" hidden>重新加载人物</button><span class="v9-avatar-label" data-coach-out="avatar-label">实心：当前 · 残影：未来趋势</span></div>
        <p class="v18-lag-note" data-coach-out="lag-note" role="status" hidden></p>
        <p class="v9-motion-advice" data-coach-out="motion-advice"></p>
        <div class="v9-mode"><button data-mode="prediction" aria-pressed="true">动作预测</button><button data-mode="practice" aria-pressed="false">练习示范</button><button data-ui="recapture" hidden>重取当前动作</button></div>
        <details class="v9-options"><summary>人物与更多设置</summary><div class="v9-settings">
          <label>视角<select data-visual="angle"><option value="oblique">侧前方</option><option value="front">正面</option></select></label>
          <label>人物<select data-setting="character"><option value="male">男性形象</option><option value="female">女性形象</option></select></label>
          <label>练习目标<select data-setting="goal"><option value="auto">随当前内容</option><option value="steady">稳住动作</option><option value="emphasis">小幅强调</option><option value="open">向外展开</option></select></label>
        </div><p data-coach-out="method-note"></p><p data-coach-out="audio-evidence"></p><p data-coach-out="motion-timing"></p><p>超过3秒为探索。声音训练版支持有声录像，观察2–4秒、预测至3秒。</p></details>
      </section>
      <section class="v9-content" aria-label="慢通道提示"><div class="v9-section-head"><h3>慢通道 <span>要点覆盖</span></h3><strong data-coach-out="coverage">—</strong></div><div class="v9-coverage"><i></i></div><p class="v21-coverage-note" data-coach-out="coverage-note"></p><div class="v18-content-cue"><h4 data-coach-out="content-cue">等待本场重点</h4><p data-coach-out="content-reason" aria-live="polite"></p></div><p class="v9-target" data-coach-out="target">等待本场重点</p><details><summary>查看观点与依据</summary><div class="v9-points" data-coach-out="points"></div><p data-coach-out="missing"></p><blockquote data-coach-out="evidence"></blockquote><p data-coach-out="semantic"></p><p>按提纲权重计算覆盖率；部分相关暂计一半。只有全部要点已对齐或经人工确认才是100%，播放结束不会自动补满；这不是演讲质量评分。</p><p data-coach-out="provenance"></p></details></section>`;
    // Keep setup available beneath the analysis instead of above the person.
    const controls=document.createElement('details');controls.className='v20-controls';
    controls.innerHTML='<summary>参数与练习设置</summary><div class="v20-controls-body"></div>';
    const controlBody=controls.querySelector('.v20-controls-body');
    for(const selector of ['.v17-parameters','[data-ui="sync-note"]','.v9-mode','.v9-options','[data-ui="presenter"]'])controlBody.append(host.querySelector(selector));
    host.append(controls);
    this.outputs=new Map([...host.querySelectorAll('[data-coach-out]')].map(el=>[el.dataset.coachOut,el]));
    this.set=(key,value)=>{const el=this.outputs.get(key),text=String(value??'');if(el&&el.textContent!==text)el.textContent=text;};
    host.querySelector('[data-ui="presenter"]').hidden=presenter;
    host.querySelector('[data-ui="sync-note"]').hidden=!presenter;
    host.querySelector('[data-ui="presenter"]').onclick=onPresenter;
    try{const preferred=localStorage.getItem('talkeval-stage-character-v9');if(['male','female'].includes(preferred))host.querySelector('[data-setting="character"]').value=preferred;}catch{}
    if(!presenter){try{const saved=JSON.parse(localStorage.getItem('talkeval-stage-windows-v14')||'{}'),query=new URLSearchParams(location.search);for(const key of ['history','horizon','method','display','strength','audio']){const input=host.querySelector(`[data-setting="${key}"]`),value=String(query.get(key)||saved[key]||input.value);if([...input.options].some(o=>o.value===value))input.value=value;}}catch{}}
    for(const input of host.querySelectorAll('[data-setting]')){
      if(presenter && ['history','horizon','goal','method','display','strength','audio'].includes(input.dataset.setting))input.disabled=true;
      input.onchange=()=>{this.practice=null;if(input.dataset.setting==='character'){try{localStorage.setItem('talkeval-stage-character-v9',input.value);}catch{}}else {try{const {history,horizon,method,display,strength,audio}=this.settings();localStorage.setItem('talkeval-stage-windows-v14',JSON.stringify({history,horizon,method,display,strength,audio}));}catch{}onSettings(this.settings());}if(this.state)this.render(this.state);};
    }
    for(const b of host.querySelectorAll('[data-mode]'))b.onclick=()=>{this.mode=b.dataset.mode;this.practice=null;if(this.state)this.render(this.state);};
    host.querySelector('[data-ui="recapture"]').onclick=()=>{this.practice=null;if(this.state)this.render(this.state);};
    for(const [name,value] of [['history','2'],['horizon','2']]){const input=host.querySelector('[data-setting="'+name+'"]');input.value=value;input.disabled=true;input.title='网页版展示原模型导出的2秒观察、2秒预测；完整时间窗请运行本机版本。';}if(!presenter&&!new URLSearchParams(location.search).has('method'))host.querySelector('[data-setting="method"]').value='audio';
    this.mode='prediction';
    const angle=host.querySelector('[data-visual="angle"]');try{if(localStorage.getItem('talkeval-stage-angle-v13')==='front')angle.value='front';}catch{}
    angle.onchange=()=>{try{localStorage.setItem('talkeval-stage-angle-v13',angle.value);}catch{}if(this.state)this.render(this.state);};
    this.expandMotion=expanded=>{const area=host.querySelector('.v9-motion'),button=host.querySelector('[data-ui="motion-fullscreen"]');this.expanded=expanded;area.classList.toggle('v13-expanded',expanded);button.textContent=expanded?'退出放大 ×':'放大 ↗';button.setAttribute('aria-label',expanded?'退出动作放大':'放大动作残影');if(expanded){this.previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';}else document.body.style.overflow=this.previousOverflow||'';};
    host.querySelector('[data-ui="motion-fullscreen"]').onclick=()=>this.expandMotion(!this.expanded);
    this.onEscape=event=>{if(event.key==='Escape'&&this.expanded)this.expandMotion(false);};document.addEventListener('keydown',this.onEscape);
    host.querySelector('[data-ui="avatar-retry"]').onclick=()=>this.ensureAvatar(true);
    this.ensureAvatar();
  }
  ensureAvatar(retry=false){
    if(!this.avatar&&this.avatarStatus?.state==='error'&&!retry)return;
    const character=this.settings().character;
    try{
      if(!this.avatar)this.avatar=new StageAvatar(this.host.querySelector('.v9-avatar-canvas'),character,{onStatus:status=>{this.avatarStatus=status;this.renderAvatarStatus();}});
      else this.avatar.changeCharacter(character,{retry}).catch(()=>{});
    }catch(error){this.avatarStatus={state:'error',message:'当前浏览器无法创建3D画面，请启用硬件加速后重试。'};this.renderAvatarStatus();}
  }
  renderAvatarStatus(){
    const status=this.avatarStatus||{state:'loading',message:'正在载入3D人物…'},motion=this.state?.motion||{};
    const waiting=status.state!=='ready'||!motion.ready;
    this.outputs.get('avatar-empty').hidden=!waiting;
    this.set('avatar-empty',status.state!=='ready'?status.message:(motion.message||'等待连续的身体观测'));
    this.host.querySelector('[data-ui="avatar-retry"]').hidden=status.state!=='error';
  }
  settings(){return Object.fromEntries([...this.host.querySelectorAll('[data-setting]')].map(el=>[el.dataset.setting,el.value]));}
  render(state) {
    this.state=state;const s=state.slow||{},m=state.motion||{};
    this.set('source','快通道 · 动作与节奏');this.set('time',`${clock(state.at||0)} · ${state.playing?'进行中':'已暂停'}`);
    this.set('cue',state.cue?.title||'等待本场输入');
    const reason=(state.cue?.reason||'').replace(/^仍在展开「[^」]+」。(?=可补清)/,'').replace('；这是尚未核实的含义，如已说清可在下方确认。','；已讲清可在详细复盘中确认。');
    this.set('reason',reason);
    this.set('content-cue',s.cue?.title||'按重点往下讲');
    this.set('content-reason',(s.cue?.reason||s.missing||'').replace(/^仍在展开「[^」]+」。(?=可补清)/,'').replace('；这是尚未核实的含义，如已说清可在下方确认。','；已讲清可在详细复盘中确认。'));
    this.host.querySelector('.v9-priority').dataset.level=state.cue?.severity?'attention':'normal';
    this.set('coverage',s.coverage==null?'—':`${s.coverage.toFixed(1)}%`);
    const summary=s.summary;
    this.set('coverage-note',summary?.total?`已对齐 ${summary.done}/${summary.total} 项${summary.partial?` · 部分 ${summary.partial} 项`:''}${summary.conflicts?` · 待核对 ${summary.conflicts} 项`:''}${summary.pending?` · 待观察 ${summary.pending} 项`:''}`:'等待本场提纲与可靠语句');
    this.host.querySelector('.v9-coverage i').style.width=`${s.coverage||0}%`;
    this.set('target',s.goal||'尚未设置本场重点');this.set('missing',s.missing||s.next||'');
    this.set('evidence',s.evidence||'还没有已结束的可靠语句。');this.set('semantic',s.semantic||'');
    this.set('provenance',s.provenance||'');
    const points=(s.points||[]).map((p,i)=>`<span data-state="${escapeHtml(p.state)}" title="${escapeHtml(p.title)}">${i+1} ${escapeHtml(p.label)} <b>${escapeHtml(p.status)}</b><small>${p.evidence?'对应原话：'+escapeHtml(p.evidence):'尚无对应原话'}${p.missing?'<br>待核对：'+escapeHtml(p.missing):''}</small></span>`).join('');
    if(points!==this.pointsMarkup){this.host.querySelector('[data-coach-out="points"]').innerHTML=points;this.pointsMarkup=points;}
    if(this.presenter&&state.settings){for(const key of ['history','horizon','goal','method','display','strength','audio'])this.host.querySelector(`[data-setting="${key}"]`).value=state.settings[key];}
    const conf=this.settings(),futureSeconds=Number(conf.horizon),goal=conf.goal==='auto'?(s.practiceGoal||'steady'):conf.goal;
    const predicting=m.ready&&m.forecastReady!==false;
    this.set('motion-status',m.held?'重新识别中':this.mode==='practice'?'练习指引':predicting?`未来${conf.horizon}秒`:m.ready?'当前姿态':'等待画面');
    const timing=predicting&&!m.held?forecastTiming(m):null;
    const longView=m.model_profile==='extended';
    const enhanced=this.mode==='prediction'&&conf.display==='trend'&&!!m.presentation?.enhanced;
    this.set('method-note',this.mode==='practice'?'练习示范按目标生成；金色为建议动作。':conf.display==='trend'?'趋势演示沿模型方向增强手臂转角，限幅并平滑；不代表原始预测精度。':'原始预测：直接展示所选基准的输出，不增强动作幅度。');
    const sound=m.presentation?.sound;
    const learnedNote=m.audio_model_used?`训练模型已使用截至${preciseClock(m.audio_input_end)}的能量、频谱和音高特征。`:conf.method==='audio'?(m.audio_model_note||'正在准备声音训练版。'):'当前预测模型只使用动作。';
    const displayNote=conf.display!=='trend'?'':conf.audio==='off'?'展示声音调节已关闭。':sound?.ready?`展示幅度另按历史音量调节：${sound.message}。`:(m.audio?.message||'展示声音调节等待音频。');
    this.set('audio-evidence',this.mode==='practice'?'声音不改变已固定的练习示范。':learnedNote+displayNote);
    const fallback=conf.method==='audio'&&predicting&&!m.held&&!m.audio_model_used;
    this.set('model-note',fallback?(m.audio_model_status==='loading'?'声音准备中，暂用动作模型。':m.audio_model_status==='unsupported'?'当前输入不支持声音版，已使用动作模型。':'声音不可用，已使用动作模型。'):'');
    this.outputs.get('model-note').hidden=!fallback;
    this.set('overlay-badge',m.held?'保持上一姿态 · 预测暂停':this.mode==='practice'?'练习示范':m.ready&&!predicting?'当前姿态 · 积累观察中':enhanced?`增强演示 · ${conf.strength}倍${longView?' · 长时探索':''}`:conf.display==='trend'?'增强演示 · 等待输入':`原始预测${longView?' · 长时探索':''}`);
    this.host.querySelector('.v9-avatar').dataset.tracking=m.held?'held':m.ready?'tracking':'waiting';
    this.host.querySelector('[data-setting="strength"]').disabled=this.presenter||conf.display!=='trend'||this.mode==='practice';
    this.host.querySelector('[data-setting="audio"]').disabled=this.presenter||conf.display!=='trend'||this.mode==='practice';
    this.set('motion-timing',timing&&this.mode==='prediction'?`${enhanced?'演示时间轴 · ':''}输入 ${preciseClock(timing.at)} → 目标 ${preciseClock(timing.target)}（+${timing.horizon.toFixed(2)}秒）${longView?' · 长时探索':''}`:'');
    this.ensureAvatar();this.renderAvatarStatus();
    const lagNote=m.held?(m.holdMessage||'正在重新识别，暂时保持上一姿态。'):m.ready&&!predicting?(m.message||'正在积累连续观察。'):m.updateError||(m.ready&&m.lagSeconds>.8?`当前动作来自约${Math.ceil(m.lagSeconds)}秒前的画面，正在更新。`:'');
    this.set('lag-note',lagNote);this.outputs.get('lag-note').hidden=!lagNote;
    this.host.querySelector('[data-ui="recapture"]').hidden=this.mode!=='practice';
    for(const button of this.host.querySelectorAll('[data-mode]'))button.setAttribute('aria-pressed',String(button.dataset.mode===this.mode));
    let frame=null;
    if(m.ready){
      if(this.mode==='practice'){
        if(!this.practice||this.practice.caseId!==state.caseId){
          const path=practiceTrajectory(m.current,m.visibility,goal,Math.round(futureSeconds*20));
          this.practice={caseId:state.caseId,current:m.current,visibility:m.visibility,detail:m.detail,future:path.positions,steps:path.steps,key:'practice-'+Date.now(),at:m.at,stream:'practice',practice:true};
        }frame=this.practice;
        const steps=this.practice.steps.map(s=>s.replace(/，约[\d.]+个肩宽/g,''));
        this.set('motion-advice',steps.length===2&&steps[0].startsWith('左手')&&steps[1].startsWith('右手')&&steps[0].slice(2)===steps[1].slice(2)?'双手'+steps[0].slice(2):steps.join('；'));
        this.set('avatar-label','实心：起点 · 金色：建议动作');
      }else{
        frame={current:m.current,visibility:m.visibility,detail:m.detail,future:enhanced?m.presentation.positions:(m.future||[]),key:`${state.caseId}:${m.at}:${conf.history}:${conf.horizon}:${conf.method}:${m.method}:${conf.display}:${conf.strength}:${conf.audio}:${m.presentation?.audioApplied}:${!!m.held}:${predicting}`,at:m.at,stream:`${state.caseId}:${conf.history}:${conf.horizon}:${conf.method}:${conf.display}:${conf.strength}:${conf.audio}:${m.source}:prediction`,practice:false,held:!!m.held,recovered:!!m.recovered,lowLatency:!!m.live,showGhosts:predicting};
        this.set('motion-advice','');
        this.set('avatar-label',m.held?'暂存的姿态与残影 · 尚未恢复实时更新':!predicting?'当前已识别姿态 · 尚未生成预测':`实心：当前 · 残影：+${(futureSeconds/3).toFixed(1)} / +${(futureSeconds*2/3).toFixed(1)} / +${futureSeconds}秒`);
      }
    }else this.set('motion-advice','');
    this.avatar?.setAngle(this.host.querySelector('[data-visual="angle"]').value);
    this.avatar?.setFrame(frame);
  }
  dispose(){if(this.expanded)this.expandMotion(false);document.removeEventListener('keydown',this.onEscape);this.avatar?.dispose();this.host.remove();}
}
