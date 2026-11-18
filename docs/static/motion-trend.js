// Deterministic presentation layer. This does NOT replace the learned forecast.
// Audio changes gain/progression only; it does not choose an invented gesture.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const mul=(a,n)=>a.map(x=>x*n);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const length=a=>Math.hypot(...a);
const unit=a=>mul(a,1/Math.max(1e-9,length(a)));
const clone=p=>p.map(v=>v.slice());

export function audioCondition(samples,at,seconds=2){
  const rows=(samples||[]).filter(s=>Number.isFinite(s.at)&&Number.isFinite(s.rms)&&s.rms>=0&&s.at>at-seconds&&s.at<=at+1e-7).sort((a,b)=>a.at-b.at);
  if(rows.length<6||rows.at(-1).at<at-.3||rows.at(-1).at-rows[0].at<.3)return {ready:false,gain:1,message:'声音样本不足，按动作推演'};
  const values=rows.map(s=>s.rms),ordered=values.slice().sort((a,b)=>a-b),p90=ordered[Math.floor((ordered.length-1)*.9)];
  const threshold=Math.max(.003,p90*.16),recent=rows.filter(s=>s.at>at-.35),base=rows.filter(s=>s.at<=at-.35);
  const activity=recent.filter(s=>s.rms>threshold).length/Math.max(1,recent.length);
  const ratio=mean(recent.map(s=>s.rms))/Math.max(.003,mean(base.map(s=>s.rms)));
  const emphasis=clamp((ratio-.85)/1.3,0,1);
  const gain=clamp(.65+.45*activity+.3*emphasis,.65,1.4);
  return {ready:true,gain,activity,emphasis,ratio,inputEnd:rows.at(-1).at,window:seconds,
    message:activity<.25?'近期能量低，幅度收敛':ratio>1.25?'音频能量上升，增强展开':'音频平稳，保持动作趋势'};
}

// Same rotation axis as the model; amplify its angle with a soft noise gate.
function amplifiedDirection(start,end,gain){
  const a=unit(start),b=unit(end),cos=clamp(dot(a,b),-1,1),angle=Math.acos(cos);
  const perpendicular=sub(b,mul(a,cos)),size=length(perpendicular);
  if(angle<1e-7||size<1e-7)return a;
  const rotation=Math.min(65*Math.PI/180,angle*gain*clamp(angle/.025,0,1));
  return add(mul(a,Math.cos(rotation)),mul(perpendicular,Math.sin(rotation)/size));
}
function interpolateDirection(start,end,t){
  const a=unit(start),b=unit(end),cos=clamp(dot(a,b),-1,1),angle=Math.acos(cos),sin=Math.sin(angle);
  if(Math.abs(sin)<1e-7)return a;
  return add(mul(a,Math.sin((1-t)*angle)/sin),mul(b,Math.sin(t*angle)/sin));
}

export function trendTrajectory(current,future,visibility,{strength=4,audio=null}={}){
  if(!current||!future?.length)return {positions:[],gain:1,enhanced:false};
  const baseGain=clamp(Number(strength)||4,1,6),gain=baseGain*(audio?.ready?audio.gain:1);
  // Average the last 250ms of MODEL output, not future observed poses/audio.
  const tail=future.slice(-Math.min(5,future.length)),end=current.map((_,j)=>[0,1,2].map(k=>mean(tail.map(p=>p[j][k]))));
  const arms=[[1,3,5],[2,4,6]].map(([s,e,w])=>{
    const valid=[s,e,w].every(j=>(visibility?.[j]||0)>=.4);
    const upper=sub(current[e],current[s]),lower=sub(current[w],current[e]);
    return {s,e,w,valid:valid&&length(upper)>.05&&length(lower)>.05,upper,lower,
      nextUpper:amplifiedDirection(upper,sub(end[e],end[s]),gain),nextLower:amplifiedDirection(lower,sub(end[w],end[e]),gain)};
  });
  const positions=future.map((_,i)=>{
    const t=(i+1)/future.length,warped=1-Math.pow(1-t,1+.45*(audio?.ready?audio.emphasis:0)),u=warped*warped*(3-2*warped),pose=clone(current);
    for(const a of arms){
      if(!a.valid)continue;
      pose[a.e]=add(pose[a.s],mul(interpolateDirection(a.upper,a.nextUpper,u),length(a.upper)));
      pose[a.w]=add(pose[a.e],mul(interpolateDirection(a.lower,a.nextLower,u),length(a.lower)));
    }
    return pose;
  });
  return {positions,gain,baseGain,enhanced:true,audioApplied:!!audio?.ready,angularLimitDegrees:65};
}
