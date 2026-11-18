import {CoachView} from './stage-coach.js?v=21';
const host=document.querySelector('#presenter-coach'),status=document.querySelector('#presenter-connection');
const token=new URLSearchParams(location.search).get('session');
const view=new CoachView(host,{presenter:true});let sequence=-1,last=null;
document.querySelector('#presenter-fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();
async function poll(){
  try{
    if(!/^[a-f0-9]{32}$/.test(token||''))throw Error('请在展示页点击“打开演讲者视图”。');
    const response=await fetch('/api/stage/session/'+token,{cache:'no-store'}),result=await response.json();if(!response.ok)throw Error(result.error);
    if(result.age_seconds>5){host.classList.add('v9-disconnected');view.avatar?.setFrame(null);status.textContent='展示页连接已中断，暂停提示。请返回展示页。';}
    else if(result.state){
      const reconnect=host.classList.contains('v9-disconnected');host.classList.remove('v9-disconnected');
      if(sequence!==result.sequence||reconnect){sequence=result.sequence;last=result.state;view.render(last);document.querySelector('#presenter-title').textContent=last.title;}
      status.textContent='已同步 · 本视图只显示分析和提示 · '+(result.state.playing?'演讲进行中':'展示页已暂停');
    }else status.textContent='已连接，等待展示页选择一场演讲。';
  }catch(error){host.classList.add('v9-disconnected');view.avatar?.setFrame(null);status.textContent=error.message;}
  finally{setTimeout(poll,500);}
}
poll();
window.__presenterState=()=>last;
