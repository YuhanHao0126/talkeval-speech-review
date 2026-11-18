import {CoachView} from '../static/stage-coach.js?v=21';
import {presenterState} from '../pages-runtime.js?v=20261118';
const host=document.querySelector('#presenter-coach'),status=document.querySelector('#presenter-connection');
const token=new URLSearchParams(location.search).get('session');
const view=new CoachView(host,{presenter:true});
document.querySelector('#presenter-fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();
setInterval(()=>{const message=presenterState(token);if(!message||Date.now()-message.at>5000){status.textContent='等待展示页同步；请保持同一浏览器的展示页打开。';return;}view.render(message.state);document.querySelector('#presenter-title').textContent=message.state.title;status.textContent='已同步 · 同一浏览器 · '+(message.state.playing?'正在播放':'已暂停');},300);
