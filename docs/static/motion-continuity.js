// Display continuity only. Held poses never become new observations or model input.
export class MotionContinuity {
  constructor(){this.reset();}
  reset(){this.last=null;this.holding=false;this.candidateAt=null;this.goodCount=0;}
  hold(message='暂时没有可靠观测，正在重新识别。'){
    this.holding=true;this.candidateAt=null;this.goodCount=0;
    return this.held(message);
  }
  held(message){
    return this.last?{...this.last,ready:true,held:true,recovered:false,holdMessage:message||'正在重新识别，暂时保持上一姿态。'}:{ready:false,message:message||'等待第一次可靠的身体观测。'};
  }
  accept(motion,{recoverySamples=2}={}){
    if(!motion?.ready||!motion.current)return this.hold(motion?.message);
    const recovered=this.holding&&!!this.last;
    if(recovered){
      if(this.candidateAt!==motion.at){this.candidateAt=motion.at;this.goodCount++;}
      if(this.goodCount<recoverySamples)return this.held('已重新看到人物，正在确认连续姿态。');
    }
    this.last={...motion,held:false,recovered};this.holding=false;this.goodCount=0;this.candidateAt=null;
    return this.last;
  }
}
