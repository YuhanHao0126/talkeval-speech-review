// Bundled case assets work on a fresh browser without a separate setup page.
const deck='/talkeval-speech-review/stage-decks/0e810190727ce5b8b66ba89264c468b8/';
export const presentationPresets={
  'demo_poisson_20261118':{
    pages:[
      {start:0,title:'人生，像一场泊松过程',text:'人生像一场泊松过程\n等待与阶跃，构成向上的轨迹',cues:['人生像一场泊松过程','一场泊松过程']},
      {start:14.6,title:'大多数时间，是等待',text:'大多数时间是等待\n漫长平稳的准备，藏在曲线的水平处',cues:['大多数时间','漫长的等待','等待当中']},
      {start:31.12,title:'平稳处，正在蓄力',text:'平稳处正在蓄力\n在独处中打磨自己\n在坚持中完善自我',cues:['积蓄力量','独处中打磨自己','坚持中完善自我','沉淀蓄力']},
      {start:42.58,title:'机遇到来，果断出击',text:'机遇到来\n果断出击\n把准备变成行动',cues:['机遇到来','契机突然出现','果断出击']},
      {start:50.02,title:'抓住机会，完成阶跃',text:'抓住机会完成阶跃\n全新阶段\n跨越式成长',cues:['抓住机会','跨越式成长','抵达新的人生阶段','完成阶跃']}
    ].map((page,i)=>({...page,url:`${deck}slide-${String(i+1).padStart(3,'0')}.jpg`}))
  }
};
