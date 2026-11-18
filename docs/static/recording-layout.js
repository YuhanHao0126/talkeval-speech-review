// A recording layout for the existing workbench, using the same video and analysis.
let activeLayout=null;
export class RecordingLayout {
  constructor(stage){
    this.stage=stage;this.frame=stage.monitor.host.closest('.lm-frame');this.video=stage.video;this.replay=stage.kind==='replay';
    this.abort=new AbortController();const signal=this.abort.signal;
    this.enterButton=document.createElement('button');this.enterButton.className='v9-nav-button';this.enterButton.textContent='录屏模式';
    this.enterButton.addEventListener('click',()=>this.enter(),{signal});this.frame.querySelector('.lm-frame-head').append(this.enterButton);
    this.header=document.createElement('header');this.header.className='v20-record-head';
    this.header.innerHTML='<div class="v20-wordmark">TalkEval<span>++</span><small>动作预测 · 内容对齐</small></div><p class="v20-record-title"></p><span class="v20-record-source"></span>';
    this.header.querySelector('.v20-record-title').textContent=stage.monitor.data.intent_map?.title||'现场演讲';
    this.header.querySelector('.v20-record-source').textContent=this.replay?'录像复盘':'现场演讲';this.frame.prepend(this.header);
    this.footer=document.createElement('footer');this.footer.className='v20-record-footer';
    this.footer.innerHTML='<button data-record="play">播放</button><input data-record="seek" type="range" min="0" max="1" step="0.05" value="0" aria-label="演讲视频进度"><time data-record="time">00:00 / 00:00</time><span class="v20-record-spacer"></span><button data-record="settings" aria-expanded="false">参数设置</button><button data-record="fullscreen">全屏</button><button data-record="exit">退出录屏</button>';
    this.frame.append(this.footer);
    this.controls=stage.view.host.querySelector('.v20-controls');
    this.footer.querySelector('[data-record="play"]').addEventListener('click',()=>{
      if(this.video.paused)this.video.play().catch(()=>{this.footer.querySelector('[data-record="play"]').textContent='点击视频播放';});else this.video.pause();
    },{signal});
    this.footer.querySelector('[data-record="seek"]').addEventListener('input',e=>{if(Number.isFinite(this.video.duration))this.video.currentTime=Number(e.target.value);},{signal});
    this.footer.querySelector('[data-record="settings"]').addEventListener('click',()=>{this.controls.open=!this.controls.open;},{signal});
    this.controls.addEventListener('toggle',()=>{const button=this.footer.querySelector('[data-record="settings"]');button.setAttribute('aria-expanded',String(this.controls.open));button.textContent=this.controls.open?'收起设置':'参数设置';},{signal});
    this.footer.querySelector('[data-record="fullscreen"]').addEventListener('click',()=>{
      (document.fullscreenElement?document.exitFullscreen():this.frame.requestFullscreen()).catch(()=>{});
    },{signal});
    this.footer.querySelector('[data-record="exit"]').addEventListener('click',()=>this.exit(),{signal});
    for(const name of ['play','pause','timeupdate','durationchange','loadedmetadata','ended'])this.video.addEventListener(name,()=>this.update(),{signal});
    if(!this.replay){this.footer.querySelector('[data-record="play"]').hidden=true;this.footer.querySelector('[data-record="seek"]').hidden=true;}
    this.update();
    if(new URLSearchParams(location.search).get('view')==='record'&&stage.visible())this.enter();
  }
  enter(){
    if(activeLayout&&activeLayout!==this)activeLayout.exit();activeLayout=this;
    document.querySelectorAll('.v20-recording-stage').forEach(frame=>{if(frame!==this.frame)frame.classList.remove('v20-recording-stage');});
    document.body.classList.add('v20-recording');this.frame.classList.add('v20-recording-stage');this.controls.open=false;
    if(!this.active){this.hadVideoControls=this.video.controls;this.active=true;}this.video.controls=false;
    const url=new URL(location.href);url.searchParams.set('view','record');history.replaceState(null,'',url);
    this.update();
  }
  exit(){
    this.frame.classList.remove('v20-recording-stage');document.body.classList.remove('v20-recording');
    if(this.active)this.video.controls=this.hadVideoControls;this.active=false;this.controls.open=false;
    if(activeLayout===this)activeLayout=null;
    if(document.fullscreenElement===this.frame)document.exitFullscreen().catch(()=>{});
    const url=new URL(location.href);url.searchParams.delete('view');history.replaceState(null,'',url);
  }
  update(){
    const at=this.replay?this.video.currentTime:this.stage.time(),duration=this.video.duration;
    this.header.querySelector('.v20-record-title').textContent=this.stage.monitor.data.intent_map?.title||(!this.replay&&document.querySelector('#coach-topic')?.value)||'现场演讲';
    const clock=value=>`${String(Math.floor(Math.max(0,value||0)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,value||0)%60)).padStart(2,'0')}`;
    this.footer.querySelector('[data-record="play"]').textContent=this.video.paused?'播放':'暂停';
    this.footer.querySelector('[data-record="time"]').textContent=clock(at)+(this.replay?' / '+clock(Number.isFinite(duration)?duration:0):'');
    const range=this.footer.querySelector('[data-record="seek"]');range.max=Number.isFinite(duration)?duration:1;range.value=at||0;
  }
  dispose(){if(this.active)this.exit();this.abort.abort();this.header.remove();this.footer.remove();this.enterButton.remove();}
}
