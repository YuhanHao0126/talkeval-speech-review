// GitHub Pages reads immutable outputs exported from the original Python models.
// No browser-side extrapolation is substituted for model inference.
const ROOT=new URL('./',import.meta.url),DEMO='demo_poisson_20261118';
const cache=new Map();
const read=file=>{if(!cache.has(file))cache.set(file,fetch(new URL(file,ROOT)).then(r=>{if(!r.ok)throw Error('案例资源加载失败，请刷新重试。');return r.json();}).catch(e=>{cache.delete(file);throw e;}));return cache.get(file);};
export async function pagesJson(input){
  const url=new URL(input,location.origin),at=Number(url.searchParams.get('at')||0);
  if(url.pathname.startsWith('/api/stage/segments/'))return {segments:url.pathname.endsWith(DEMO)?[{start:0,end:67.8,split:'user_replay_not_training'}]:[]};
  if(url.pathname==='/api/stage/forecast'){
    if(url.searchParams.get('case_id')!==DEMO)return {ready:false,cached:true,message:'此案例保留原有复盘；动作预测请切换「人生，像一场泊松过程」新版演示。'};
    const method=url.searchParams.get('method');
    if(!['audio','gru','adaptive','persistence'].includes(method))throw Error('未知预测方法');
    const data=await read('demo/motion-'+method+'.json');
    return data.rows[Math.max(0,Math.min(data.rows.length-1,Math.floor(at/data.step+1e-6)))];
  }
  if(url.pathname==='/api/stage/audio'){
    if(url.searchParams.get('case_id')!==DEMO)return {ready:false,status:'unavailable',message:'此案例未导出声音缓存。'};
    const data=await read('demo/audio.json');
    return data.rows[Math.max(0,Math.min(data.rows.length-1,Math.floor(at/data.step+1e-6)))];
  }
  throw Error('此操作需要本机完整版本，网页版提供案例演示。');
}
let channel=null,lastPublished=0;
const key=token=>'talkeval-pages-presenter:'+token;
export function openPresenter(){
  channel=crypto.randomUUID().replaceAll('-','');
  const child=window.open(new URL('presenter/?session='+channel,ROOT),'talkeval-presenter','width=780,height=1000');
  if(!child)alert('请允许弹出窗口后重试演讲者视图。');
}
export function publish(state){
  if(!channel||performance.now()-lastPublished<200)return;
  lastPublished=performance.now();
  try{localStorage.setItem(key(channel),JSON.stringify({state,at:Date.now()}));}catch{}
}
export function presenterState(token){try{return JSON.parse(localStorage.getItem(key(token))||'null');}catch{return null;}}
