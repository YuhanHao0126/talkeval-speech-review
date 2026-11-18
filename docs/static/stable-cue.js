// Keep complete sentences still while they are being read. Each channel owns a gate.
export class StableCueGate {
  constructor({hold=6,settle=1.2,refresh=8}={}) {Object.assign(this,{hold,settle,refresh});this.reset();}
  reset(){this.current=null;this.pending=null;this.since=0;this.updated=0;this.lastTime=null;this.lastClock=null;}
  key(cue){return cue.actionKey||`${cue.code||''}:${cue.beatId||''}:${cue.title||''}`;}
  show(cue,time,clock){
    if(!cue)return this.current;
    if((this.lastTime!==null&&time<this.lastTime-.1)||(this.lastClock!==null&&clock<this.lastClock))this.reset();
    this.lastTime=time;this.lastClock=clock;
    const accept=()=>{this.current={...cue};this.since=clock;this.updated=clock;this.pending=null;return this.current;};
    if(!this.current)return accept();
    if(this.key(cue)===this.key(this.current)){
      this.pending=null;
      if(clock-this.updated>=this.refresh){this.current={...cue};this.updated=clock;}
      return this.current;
    }
    const key=this.key(cue);
    if(this.pending?.key!==key)this.pending={key,since:clock};
    // Closing/deadline cues may interrupt after a short confirmation; normal advice may not.
    const urgent=(cue.priority||0)>=90&&(cue.priority||0)>(this.current.priority||0);
    if(clock-this.pending.since>=(urgent?.25:this.settle)&&(urgent||clock-this.since>=this.hold))return accept();
    return this.current;
  }
}
