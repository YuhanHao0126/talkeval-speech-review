import {blendPose, forecastPose} from './presentation.js?v=8';

// Future[0] is +1/fps, not t=0. Include the current pose when sampling
// fractional time so the three trails really are H/3, 2H/3 and H.
export function framePoses(frame){
  return {current:frame.current,ghosts:[1/3,2/3,1].map(t=>forecastPose(frame.current,frame.future||[],t)),at:frame.at};
}
export class PoseTransition {
  constructor(){this.frame=null;this.from=null;this.to=null;this.duration=250;this.since=0;}
  sample(now){
    if(!this.to)return null;
    const u=Math.max(0,Math.min(1,(now-this.since)/this.duration));
    if(!this.from||u===1)return {...this.to,settled:true};
    return {current:blendPose(this.from.current,this.to.current,u),ghosts:this.to.ghosts.map((p,i)=>blendPose(this.from.ghosts[i],p,u)),
      at:this.from.at+(this.to.at-this.from.at)*u,settled:false};
  }
  setFrame(frame,now){
    if(frame?.key===this.frame?.key)return false;
    const previous=this.sample(now),old=this.frame,interval=now-this.since;
    if(frame?.held&&previous){this.frame=frame;this.to=previous;this.from=null;this.duration=1;this.since=now;return true;}
    const continuous=frame&&old&&frame.stream===old.stream&&frame.at>=old.at&&(frame.at-old.at<=.8||frame.recovered);
    this.frame=frame;this.to=frame?framePoses(frame):null;
    this.from=continuous?previous:null;
    this.duration=frame?.recovered?260:frame?.lowLatency?Math.max(45,Math.min(120,interval*.65||80)):Math.max(100,Math.min(400,interval||250));this.since=now;
    return true;
  }
}

export function forecastTiming(motion){
  const fps=Number(motion.sampling_fps||20),frames=motion.future?.length||motion.horizon_frames||0;
  const horizon=frames/fps,at=Number(motion.at);
  return {at,target:at+horizon,horizon,frames,fps};
}
export function wristDisplacements(current,future,visibility){
  if(!current||!future?.length)return [];
  return [5,6].map(j=>(visibility?.[j]||0)>=.4?Math.hypot(...future.at(-1)[j].map((v,k)=>v-current[j][k])):null);
}
