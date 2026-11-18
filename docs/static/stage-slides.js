import {escapeHtml as esc,clock} from './stage-coach.js?v=21';
import {presentationPresets} from './presentation-presets.js?v=23';
import {deckTextCatalog} from './deck-text-catalog.js?v=23';
import {ContentSlideFollower} from './content-slides.js?v=23';
import {readPptxText} from './deck-text.js?v=23';
export const markedPage=p=>Number.isFinite(p?.start)&&p.start>=0;
export function pageAt(pages,at){let chosen=-1,latest=-1;if(!Number.isFinite(at))return chosen;pages.forEach((p,i)=>{if(markedPage(p)&&p.start<=at&&p.start>=latest){chosen=i;latest=p.start;}});return chosen;}
export function nextPage(pages,at){return pages.map((p,index)=>({...p,index})).filter(p=>markedPage(p)&&p.start>at).sort((a,b)=>a.start-b.start)[0]||null;}
const bundledText=Object.fromEntries(Object.values(presentationPresets).flatMap(d=>d.pages).map(p=>[p.url,p]));
const readStored=key=>{try{const d=JSON.parse(localStorage.getItem(key)||'null');return Array.isArray(d?.pages)&&d.pages.length&&d.pages.every(p=>p&&typeof p.url==='string'&&p.url)?d:null;}catch{return null;}};
function enrichPages(pages){return pages.map(p=>{
  let path;try{path=new URL(p.url,location.href).pathname;}catch{path=p.url;}
  const meta=bundledText[path]||deckTextCatalog[path]||{};
  return {...meta,...p,title:!p.title||/^第\d+页$/.test(p.title)?meta.title||p.title:p.title,text:p.text??meta.text??'',cues:p.cues??meta.cues??[]};
});}
export class SlideRail{
  constructor(host,{caseId,visual={},time,seek,source='replay',getContext=()=>({units:[]})}){
    Object.assign(this,{host,caseId,time,seek,source,getContext,selected:-1,follow:true,sourceCaseId:null});
    this.mode=source==='live'?'content':'time';this.follower=new ContentSlideFollower();
    this.original=(visual.beats||[]).filter(b=>b.ppt_url&&Number.isFinite(b.ppt_time)).map((b,i)=>({url:new URL(b.ppt_url,location.href).href,start:b.ppt_time,title:b.note_title||('抽帧'+(i+1)),text:b.note_summary||b.note_title||''})).sort((a,b)=>a.start-b.start);
    this.preset=presentationPresets[caseId]||null;this.storageKey='talkeval-deck-v9:'+caseId;
    this.custom=readStored(this.storageKey)||(this.preset?structuredClone(this.preset):null);
    this.pages=enrichPages(this.custom?.pages||this.original);
    host.className='v9-slides';
    host.innerHTML='<div class="v9-section-head"><h3>PPT <span data-slide-mode></span></h3><label class="v9-follow"><input type="checkbox" checked> 自动跟随</label><button class="v22-slide-resume" data-slide-resume hidden>恢复自动跟随</button></div>'
      +'<div class="v9-slide-stage"><img alt="本场PPT页面或投影证据" hidden><p data-slide-empty>尚未载入PPT。可从案例带入配套PPT，或在下方导入。</p><span data-slide-stamp></span></div>'
      +'<p class="v23-slide-evidence" data-slide-evidence role="status"></p>'
      +'<details class="v16-slide-options"><summary>PPT页面与设置</summary><div class="v9-slide-rail" aria-label="PPT页面列表"></div>'
      +'<div class="v9-slide-tools"><label>翻页方式<select data-slide-follow-mode><option value="content">跟随演讲内容</option><option value="time">按录像翻页时间</option></select></label><button data-slide-import>导入PPT / 图片</button><input type="file" accept=".pptx,.png,.jpg,.jpeg,.webp" multiple hidden><button data-slide-mark>此页从当前时刻开始</button><button data-slide-restore>恢复案例PPT</button></div>'
      +'<label class="v23-page-text">本页要点（用于匹配演讲内容）<textarea data-slide-text rows="2" maxlength="6000" placeholder="每行填写本页一个主题或关键短语；PPTX会自动读取文字。"></textarea></label><button data-slide-save-text>保存本页要点</button>'
      +'<div class="v23-slide-test"><label>试输一句话<input data-slide-test-text maxlength="300" placeholder="不用开启摄像头，先检查这句话会切到哪一页"></label><button data-slide-test>测试内容翻页</button><small>这是文字测试，不计入演讲记录；恢复自动跟随后使用实际语句。</small></div>'
      +'<p class="v9-slide-note" data-slide-note></p></details><p class="v9-slide-note" data-slide-status role="status"></p>';
    host.querySelector('[data-slide-follow-mode]').value=this.mode;
    host.querySelector('[data-slide-follow-mode]').onchange=e=>{this.mode=e.target.value;this.follower.reset();this.setFollow(true);this.save();};
    host.querySelector('[data-slide-follow-mode] option[value="time"]').disabled=source==='live';
    host.querySelector('input[type="checkbox"]').onchange=e=>this.setFollow(e.target.checked);
    host.querySelector('[data-slide-resume]').onclick=()=>this.setFollow(true);
    const file=host.querySelector('input[type="file"]');host.querySelector('[data-slide-import]').onclick=()=>file.click();file.onchange=()=>this.upload(file.files);
    host.querySelector('[data-slide-mark]').onclick=()=>{if(!this.custom||this.selected<0)return;this.pages[this.selected].start=Number(this.time().toFixed(2));this.save();this.drawRail();this.syncLabel();};
    host.querySelector('[data-slide-restore]').onclick=()=>{this.custom=this.preset?structuredClone(this.preset):null;this.pages=enrichPages(this.custom?.pages||this.original);this.selected=-1;try{localStorage.removeItem(this.storageKey);}catch{}this.follower.reset();this.drawRail();this.setFollow(true);};
    host.querySelector('[data-slide-save-text]').onclick=()=>{if(this.selected<0)return;const page=this.pages[this.selected];page.text=host.querySelector('[data-slide-text]').value.trim();page.cues=[];this.custom={pages:this.pages};this.save();this.follower.reset();this.drawRail();this.update();host.querySelector('[data-slide-status]').textContent='本页要点已保存。';};
    host.querySelector('[data-slide-test]').onclick=()=>this.testText(host.querySelector('[data-slide-test-text]').value);
    this.drawRail();this.update();
  }
  useSourceCase(caseId){
    if(this.source!=='live'||caseId===this.sourceCaseId)return;
    this.sourceCaseId=caseId;this.preset=presentationPresets[caseId]||null;
    this.storageKey=caseId?'talkeval-deck-v23:live:'+caseId:'talkeval-deck-v9:camera';
    this.custom=readStored(this.storageKey)||(caseId?readStored('talkeval-deck-v9:'+caseId):null)||(this.preset?structuredClone(this.preset):null);
    this.pages=enrichPages(this.custom?.pages||[]);this.selected=-1;this.mode='content';this.follower.reset();this.preview=null;
    this.host.querySelector('[data-slide-follow-mode]').value=this.mode;this.follow=true;this.host.querySelector('input[type="checkbox"]').checked=true;this.drawRail();
  }
  save(){this.custom={pages:this.pages,followMode:this.mode};try{localStorage.setItem(this.storageKey||'talkeval-deck-v9:'+this.caseId,JSON.stringify(this.custom));}catch{}}
  setFollow(value){this.follow=!!value;this.preview=null;if(this.follow)this.follower?.reset();this.host.querySelector('input[type="checkbox"]').checked=this.follow;this.update();}
  selectPage(index){const page=this.pages[index];if(!page)return;if(this.mode!=='content'&&this.follow&&markedPage(page)){this.seek(page.start);this.show(index);this.syncLabel();}else{this.follow=false;this.preview=null;this.host.querySelector('input[type="checkbox"]').checked=false;this.show(index);this.syncLabel();}}
  testText(text){
    text=String(text||'').trim();if(!text)return;
    if(!this.preview)this.preview={follower:new ContentSlideFollower(),units:[]};
    const at=this.preview.units.length+1;this.preview.units.push({text,time_span:[at-1,at],source:'manual-test',reliability:{text:1}});
    this.contentResult=this.preview.follower.update(this.pages,this.preview.units,{at,sessionId:'text-test'});
    this.follow=false;this.host.querySelector('input[type="checkbox"]').checked=false;this.show(this.contentResult.index);this.syncLabel();
  }
  syncLabel(){
    const marked=this.pages.filter(markedPage).length,next=nextPage(this.pages,this.time()),p=this.pages[this.selected],content=this.mode==='content';
    const mode=this.preview?'文字测试':!this.follow?'手动预览':content?'跟随演讲内容':'按录像时间';
    this.host.querySelector('[data-slide-mode]').textContent=mode;
    this.host.querySelector('[data-slide-resume]').hidden=this.follow||!this.pages.length;
    this.host.querySelector('[data-slide-stamp]').textContent=p?'第'+(this.selected+1)+'/'+this.pages.length+'页 · '+(this.preview?'文字测试':!this.follow?'手动预览':content?'依据当前语句':next?'下次 '+clock(next.start):marked<this.pages.length?'仍有页面未标记':'最后一页'):'';
    let note='';const result=this.contentResult,context=this.context||{};
    if(this.preview)note='文字测试：'+(result?.evidence?'“'+result.evidence.text+'” → 本页':'没有明确匹配，保持当前页。');
    else if(this.follow&&content){
      if(!this.pages.length)note='先载入本场PPT；从案例点击“用本场PPT与提纲演讲”可一起带入。';
      else if(!result?.ready)note='尚无页面文字，请展开设置补充各页要点。';
      else if(!result.received)note=context.active?'尚未收到可用转写，PPT保持本页。'+(context.speechStatus||'请查看摄像头下方的语音识别状态。'):'等待开始演讲，语句稳定后按内容切换。';
      else if(result.evidence&&result.heard.includes(result.evidence.text))note=(result.evidence.source==='manual'?'手动记录':result.interim?'识别中（稳定词句）':'已收到')+'：“'+result.evidence.text.slice(0,100)+'”';
      else note='保持本页；最近语句尚未明确匹配新页：“'+result.heard.slice(0,80)+'”';
    }
    this.host.querySelector('[data-slide-evidence]').textContent=note;
    const upcoming=content?this.pages[this.selected+1]:next;
    if(upcoming&&upcoming.url!==this.preloadedUrl){this.preloadedUrl=upcoming.url;this.preload=new Image();this.preload.src=upcoming.url;}
  }
  drawRail(){
    this.host.querySelector('.v9-slide-rail').innerHTML=this.pages.map((p,i)=>'<button data-slide="'+i+'" aria-label="第'+(i+1)+'页 '+esc(p.title||'')+'" aria-pressed="false"><img src="'+esc(p.url)+'" alt="" loading="lazy"><span>'+String(i+1).padStart(2,'0')+' · '+esc(p.title||'未填写要点')+'</span></button>').join('');
    for(const b of this.host.querySelectorAll('[data-slide]'))b.onclick=()=>this.selectPage(Number(b.dataset.slide));
    this.host.querySelector('[data-slide-mark]').disabled=!this.custom||this.source==='live';
    this.host.querySelector('[data-slide-restore]').disabled=!this.preset&&!this.original.length;
    this.host.querySelector('[data-slide-note]').textContent='现场演讲按收到的转写匹配各页内容，不按预设秒数翻页。没有明确匹配时保持当前页；点击缩略图可手动接管，之后点“恢复自动跟随”。PPTX自动读取文字，图片页需补充要点。';
  }
  show(index){
    if(index===this.selected)return;this.selected=index;const p=this.pages[index],img=this.host.querySelector('.v9-slide-stage>img');
    img.hidden=!p;this.host.querySelector('[data-slide-empty]').hidden=!!p;
    if(p){img.src=p.url;img.onerror=()=>{img.hidden=true;const empty=this.host.querySelector('[data-slide-empty]');empty.hidden=false;empty.textContent='页面资源不可用，请重新导入PPT。';};}
    this.host.querySelector('[data-slide-text]').value=p?.text||'';
    this.host.querySelector('[data-slide-save-text]').disabled=!p;
    this.host.querySelectorAll('[data-slide]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.slide)===index)));
    this.syncLabel();
  }
  update(){
    if(this.getContext)this.context=this.getContext()||{};
    if(this.source==='live')this.useSourceCase(this.context?.sourceCaseId||null);
    if(this.follow){
      if(this.mode==='content'){this.contentResult=this.follower.update(this.pages,this.context?.units||[],{at:this.time(),sessionId:this.context?.sessionId||this.caseId,interim:this.context?.interim});this.show(this.contentResult.index);}
      else this.show(pageAt(this.pages,this.time()));
    }
    this.syncLabel();
  }
  async upload(files){
    if(!files.length)return;const status=this.host.querySelector('[data-slide-status]'),button=this.host.querySelector('[data-slide-import]');button.disabled=true;status.textContent='正在导入页面与文字…';
    try{
      if(files.some(f=>/\.pptx$/i.test(f.name)))throw Error('网页版请先把PPT导出为PNG/JPG后导入；PPTX页面转换需要本机完整版本。');
      if(files.length>80||files.some(f=>!/^image\/(png|jpeg|webp)$/.test(f.type)||f.size>5*1024*1024))throw Error('请选择不超过80张PNG/JPG/WebP图片，每张不超过5MB。');
      this.pages=await Promise.all([...files].map((file,i)=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('图片读取失败'));reader.onload=()=>resolve({url:reader.result,start:i===0?0:null,title:'第'+(i+1)+'页',text:''});reader.readAsDataURL(file);})));
      this.custom={pages:this.pages};this.selected=-1;this.mode='content';this.host.querySelector('[data-slide-follow-mode]').value='content';this.drawRail();this.setFollow(true);try{this.save();status.textContent='图片已在浏览器导入，请补充各页文字后使用内容跟随。';}catch{status.textContent='图片已导入当前页面，容量较大，刷新后需重新导入；请补充各页文字。';}return;
      let textPages=[],textWarning='';if(files.length===1&&/\.pptx$/i.test(files[0].name))try{textPages=await readPptxText(files[0]);}catch(error){textWarning=error.message;}
      const form=new FormData();for(const file of files)form.append('files',file);
      let response=await fetch('/api/stage/deck',{method:'POST',body:form}),data=await response.json();if(!response.ok)throw Error(data.error);const id=data.id;
      while(data.status==='running'){await new Promise(resolve=>setTimeout(resolve,1000));data=await(await fetch('/api/stage/deck/'+id)).json();}
      if(data.status!=='done')throw Error(data.error||'页面转换未完成');
      this.pages=data.pages.map((url,i)=>({url,start:i===0?0:null,title:textPages[i]?.title||('第'+(i+1)+'页'),text:textPages[i]?.text||''}));this.custom={pages:this.pages};this.selected=-1;this.mode='content';this.host.querySelector('[data-slide-follow-mode]').value=this.mode;
      this.save();this.drawRail();this.setFollow(true);
      status.textContent='已导入'+this.pages.length+'页，'+textPages.filter(p=>p.text).length+'页读到文字。'+(textWarning||'收到语句后按内容自动跟随；可在设置中补充本页要点。');
    }catch(error){status.textContent='导入失败：'+error.message;}finally{button.disabled=false;}
  }
}
