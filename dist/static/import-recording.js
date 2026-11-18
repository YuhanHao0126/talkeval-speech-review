const shared=window.TalkEvalShared;
const openButton=document.createElement('button');openButton.className='v9-nav-button';openButton.textContent='导入我的视频';openButton.id='import-recording';
document.querySelector('.topbar-actions').prepend(openButton);
const editButton=document.createElement('button');editButton.className='v9-nav-button';editButton.textContent='补充提纲 / 字幕';editButton.hidden=true;editButton.id='edit-recording-materials';
document.querySelector('.topbar-actions').append(editButton);
const dialog=document.createElement('dialog');dialog.className='recording-import';dialog.setAttribute('aria-labelledby','import-title');
dialog.innerHTML=`<form id="import-form"><div class="import-heading"><h2 id="import-title">把自己的视频加入案例库</h2><button type="button" data-close aria-label="关闭导入">×</button></div>
  <p>导入后可回放录像、查看动作趋势，再结合字幕核对演讲重点。视频保存在本机，不会自动加入训练集。</p>
  <div data-new><label>演讲视频 <input name="video" type="file" accept=".mp4,.webm,video/mp4,video/webm" required></label><small>MP4 / WebM，最多1GB、2小时。推荐H.264编码的MP4。</small>
  <label>演讲标题 <input name="topic" maxlength="100" placeholder="例如：我的五分钟答辩练习"></label>
  <label>演讲者 / 记忆ID <input name="speaker" maxlength="48" placeholder="我的视频"></label></div>
  <label>本次想讲清楚的重点（可选，每行一条）<textarea name="outline" rows="3" maxlength="16000" placeholder="例如：项目解决什么问题&#10;算法怎么实现&#10;实验结果与不足"></textarea></label>
  <label>时间字幕（可选，SRT / VTT）<input name="subtitle" type="file" accept=".srt,.vtt"></label>
  <p class="import-subtitle-note" data-subtitle-note>没有字幕也能看录像和动作提示；内容核对需要带时间戳的实际字幕。系统暂不自动转写视频，也不会把提纲当成你说过的话。</p>
  <label data-edit hidden><input name="clearSubtitle" type="checkbox">移除这场录像的现有字幕</label>
  <div class="import-status" role="status" aria-live="polite"></div><progress hidden max="100"></progress>
  <div class="import-actions"><button type="button" data-close>取消</button><button type="submit" class="import-primary">加入案例库并打开</button></div></form>`;
document.body.append(dialog);
const form=dialog.querySelector('form'),status=dialog.querySelector('.import-status'),submit=form.querySelector('[type="submit"]'),progress=form.querySelector('progress');
let editing=null,busy=false;
function setBusy(value){busy=value;for(const el of form.querySelectorAll('button,input,textarea'))el.disabled=value;}
function open(session=null){
  form.reset();editing=session;status.textContent='';progress.hidden=true;
  dialog.querySelector('[data-new]').hidden=!!session;form.elements.video.required=!session;
  dialog.querySelector('[data-edit]').hidden=!session;
  dialog.querySelector('#import-title').textContent=session?'补充这场录像的复盘资料':'把自己的视频加入案例库';
  submit.textContent=session?'保存并重新核对':'加入案例库并打开';
  if(session)form.elements.outline.value=session.reviewMaterials?.outline||'';
  dialog.querySelector('[data-subtitle-note]').textContent=session?.segments?.length?`本场已有${session.segments.length}条字幕；不选新文件则保留。补充重点后会按录像时间重新核对。`:'没有字幕也能看录像和动作提示；内容核对需要带时间戳的实际字幕。系统暂不自动转写视频，也不会把提纲当成你说过的话。';
  dialog.showModal();
}
for(const button of form.querySelectorAll('[data-close]'))button.onclick=()=>{if(!busy)dialog.close();};
dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
openButton.onclick=()=>open();
editButton.onclick=()=>{const id=window.TalkEvalIntegration?.getReplay()?.monitor.data.saved_session?.id;const s=shared.sessions().find(s=>s.id===id);if(s)open(s);};
setInterval(()=>{const s=window.TalkEvalIntegration?.getReplay()?.monitor.data.saved_session;editButton.hidden=!(s?.sourceType==='imported_video'&&shared.canManage(s.id)&&!document.querySelector('#review-view').hidden);},500);
form.elements.video.onchange=()=>{if(!form.elements.topic.value)form.elements.topic.value=(form.elements.video.files[0]?.name||'').replace(/\.[^.]+$/,'').slice(0,100);};

async function checkVideo(file){
  if(!file||! /\.(mp4|webm)$/i.test(file.name))throw Error('请选择MP4或WebM视频。');
  if(file.size>1024**3)throw Error('视频超过1GB，请先压缩或截取需要复盘的片段。');
  const video=document.createElement('video'),url=URL.createObjectURL(file);video.preload='auto';video.muted=true;
  try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('读取视频超时，请导出为H.264编码的MP4后重试。')),20000);
    video.onloadeddata=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(Error('浏览器无法播放这个视频。请导出为H.264编码的MP4后重试。'));};video.src=url;
  });if(!Number.isFinite(video.duration)||video.duration>7200)throw Error('视频时长无效或超过2小时。');}
  finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
function upload(id,data){return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open('POST',shared.url('/api/sessions/'+id+'/import'));xhr.setRequestHeader('X-Session-Key',shared.ownerKey(id,true));xhr.timeout=300000;
  xhr.upload.onprogress=e=>{if(e.lengthComputable){progress.hidden=false;progress.value=e.loaded/e.total*100;status.textContent=progress.value<100?`正在保存到本机… ${Math.round(progress.value)}%`:'已传完，正在检查视频与字幕…';}};
  xhr.onload=()=>{let result;try{result=JSON.parse(xhr.responseText);}catch{return reject(Error('服务未返回有效结果，请检查本机服务是否运行。'));}
    if(xhr.status>=200&&xhr.status<300)resolve(result);else reject(Error(result.error||'导入失败。'));};
  xhr.onerror=()=>reject(Error('无法连接本机服务，请检查启动窗口。'));xhr.ontimeout=()=>reject(Error('导入等待超时，请刷新案例库确认保存状态后再试。'));xhr.send(data);
});}
form.onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const session=window.TalkEvalIntegration?.getCamera()?.monitor.bridge.getState().session;
  if(session){status.textContent='请先结束并保存当前正在录制的演讲，再导入复盘视频。';return;}
  const video=form.elements.video.files[0],subtitle=form.elements.subtitle.files[0],outline=form.elements.outline.value;
  if(subtitle&&subtitle.size>1024**2){status.textContent='字幕不能超过1MB。';return;}
  const data=new FormData(form);setBusy(true);status.textContent='正在检查文件…';
  try{
    let result;
    if(editing){
      const text=form.elements.clearSubtitle.checked?'':subtitle?await subtitle.text():editing.reviewMaterials?.subtitle||'';
      result=await(await shared.request('/api/sessions/'+editing.id+'/review-materials',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({outline,subtitle:text})})).json();
    }else{await checkVideo(video);if(!subtitle)data.delete('subtitle');result=await upload('import-'+crypto.randomUUID(),data);}
    await shared.refresh();await window.TalkEvalReplay.refresh();
    document.querySelector('#review-tab').click();
    await window.TalkEvalReplay.selectCase(shared.caseId(result.session.id),{at:0,playing:false});
    history.replaceState(null,'','/site/?case='+encodeURIComponent(shared.caseId(result.session.id)));
    dialog.close();document.body.classList.add('v9-library-open');document.querySelector('#case-search').value='';document.querySelector('#case-search').dispatchEvent(new Event('input'));
    document.querySelector('#launch-stage')?.scrollIntoView({block:'start'});
  }catch(error){status.textContent=error.message;}
  finally{setBusy(false);progress.hidden=true;}
};
