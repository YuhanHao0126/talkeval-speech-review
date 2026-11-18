import * as THREE from 'three';
import {loadSpeakerAvatars} from './avatar.js?v=10';
import {PoseTransition} from './stage-motion.js?v=19';

// Rendering interpolation is independent from inference. Raw forecast is untouched.
export class StageAvatar {
  constructor(host,character='male',{onStatus=()=>{}}={}) {
    this.onStatus=onStatus;this.loadState='idle';
    this.host=host;this.scene=new THREE.Scene();this.closed=false;this.frame=null;this.transition=new PoseTransition();this.dirty=true;this.angle='oblique';
    this.camera=new THREE.PerspectiveCamera(35,1,.01,100);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.25));
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.05;
    this.renderer.autoClear=false;
    host.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xffffff,0xaaa1b8,2.1));
    for(const [color,power,x,y,z] of [[0xfff4e8,2.8,-3,4,5],[0xe1e9ff,1.2,3,1,3],[0xffffff,2,1,3,-4]]){
      const light=new THREE.DirectionalLight(color,power);light.position.set(x,y,z);this.scene.add(light);
    }
    this.resize=new ResizeObserver(()=>{
      const {width,height}=host.getBoundingClientRect();if(!width||!height)return;
      this.width=width;this.height=height;
      this.renderer.setSize(width,height);this.dirty=true;
    });this.resize.observe(host);
    this.character='';this.changeCharacter(character).catch(()=>{});this.loop();
  }
  actors(avatars=this.avatars){return avatars?[avatars.actual,avatars.predicted,...avatars.ghosts].filter(Boolean):[];}
  async changeCharacter(character,{retry=false}={}) {
    if(this.requestedCharacter===character&&this.loadState==='loading')return this.loadPromise;
    if(this.requestedCharacter===character&&this.loadState==='error'&&!retry)return;
    if(this.character===character&&this.loadState==='ready')return;
    this.requestedCharacter=character;const version=this.loadVersion=(this.loadVersion||0)+1;
    this.loadState='loading';this.onStatus({state:'loading',message:'正在载入3D人物…'});
    this.loadPromise=(async()=>{
      try{
        const avatars=await loadSpeakerAvatars(this.scene,'standard',character,{predicted:false});
        if(this.closed||version!==this.loadVersion){this.actors(avatars).forEach(a=>a.dispose());return;}
        this.actors().forEach(a=>a.dispose());
        avatars.ghosts.forEach((ghost,i)=>ghost.model.traverse(o=>{if(o.isMesh)for(const material of(Array.isArray(o.material)?o.material:[o.material]))material.opacity=[.13,.26,.58][i];}));
        this.avatars=avatars;this.character=character;this.dirty=true;this.loadState='ready';this.onStatus({state:'ready'});
      }catch(error){if(!this.closed&&version===this.loadVersion){this.loadState='error';this.onStatus({state:'error',message:'3D人物没有载入，点击下方重试。'});}throw error;}
    })();
    return this.loadPromise;
  }
  setFrame(frame) {
    if(this.transition.setFrame(frame,performance.now())){this.frame=frame;this.dirty=true;}
  }
  setAngle(value){const angle=value==='front'?'front':'oblique';if(this.angle!==angle){this.angle=angle;this.dirty=true;}}
  draw(view){
    const aspect=view.width/view.height;
    this.camera.aspect=aspect;
    const z=Math.max(3.9,3.6/(2*Math.tan(THREE.MathUtils.degToRad(17.5))*aspect));
    const azimuth=this.angle==='oblique'?.55:0;
    this.camera.position.set(z*Math.sin(azimuth),.05,z*Math.cos(azimuth));this.camera.lookAt(0,-.12,0);this.camera.updateProjectionMatrix();
    this.renderer.setViewport(view.x,view.y,view.width,view.height);this.renderer.setScissor(view.x,view.y,view.width,view.height);
    this.renderer.render(this.scene,this.camera);
  }
  loop() {
    if(this.closed)return;
    this.raf=requestAnimationFrame(()=>this.loop());
    if(document.hidden||!this.width||!this.height||(!this.host.checkVisibility?.() && !this.host.offsetWidth))return;
    const a=this.avatars,f=this.frame,pose=this.transition.sample(performance.now());
    if(!this.dirty&&(!pose||pose.settled))return;
    const ready=!!(a&&f?.current&&pose);
    if(ready){
      this.displayed=pose.current;this.displayedGhosts=pose.ghosts;this.displayedAt=pose.at;
      a.actual.update(pose.current,f.visibility,f.detail);
      a.ghosts.forEach((ghost,i)=>{ghost.tintGhost(f.practice?0xc58d40:[0x91b8d5,0x32afa9,0x137d82][i]);ghost.update(pose.ghosts[i],f.visibility,null);});
    }else {this.actors().forEach(actor=>actor.group.visible=false);}
    this.renderer.setScissorTest(false);this.renderer.setViewport(0,0,this.width,this.height);this.renderer.clear();this.renderer.setScissorTest(true);
    if(ready){a.actual.group.visible=true;a.ghosts.forEach(g=>g.group.visible=f.showGhosts!==false);}
    this.draw({x:0,y:0,width:this.width,height:this.height});
    this.renderer.setScissorTest(false);
    // Draw the exact end pose once before idling. No repeated skinning while paused.
    this.dirty=!!pose&&!pose.settled;
  }
  dispose(){this.closed=true;cancelAnimationFrame(this.raf);this.resize.disconnect();
    this.actors().forEach(a=>a.dispose());
    this.renderer.dispose();this.renderer.domElement.remove();}
}
