// Comparison describes the unscaled forecast. It never edits a pose or a model output.
const distance=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
const angle=(p,s,e,w)=>{
  const a=p[s].map((x,i)=>x-p[e][i]),b=p[w].map((x,i)=>x-p[e][i]);
  const length=Math.hypot(...a)*Math.hypot(...b);
  return length<1e-8?null:Math.acos(Math.max(-1,Math.min(1,a.reduce((n,x,i)=>n+x*b[i],0)/length)))*180/Math.PI;
};
export function wristComparison(current,future,visibility){
  return [[1,3,5,1,'左手'],[2,4,6,-1,'右手']].map(([s,e,w,side,name])=>{
    const valid=!!current&&!!future?.length&&[s,e,w].every(j=>(visibility?.[j]||0)>=.4);
    if(!valid)return {name,valid:false};
    const end=future.at(-1),delta=end[w].map((x,i)=>x-current[w][i]),move=distance(end[w],current[w]);
    const axis=delta.map(Math.abs).indexOf(Math.max(...delta.map(Math.abs)));
    const direction=move<.04?'变化较小':axis===1?(delta[1]>0?'上抬':'下落'):axis===0?(delta[0]*side>0?'向外展开':'向内收回'):(delta[2]>0?'向前移动':'向后收回');
    const before=angle(current,s,e,w),after=angle(end,s,e,w);
    return {name,valid:true,distance:move,direction,elbowChange:before===null||after===null?null:after-before};
  });
}

// Same camera/scale for both panels; no translation is added to the pose data.
export function comparisonViewports(width,height){
  if(width<520){const h=Math.floor(height/2);return [{x:0,y:h,width,height:height-h},{x:0,y:0,width,height:h}];}
  const w=Math.floor(width/2);return [{x:0,y:0,width:w,height},{x:w,y:0,width:width-w,height}];
}
