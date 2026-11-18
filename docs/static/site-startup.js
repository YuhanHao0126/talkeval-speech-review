(() => {
  const root=document.documentElement;
  let done=false;
  const message=text=>{const node=document.querySelector('[data-startup-message]');if(node)node.textContent=text;};
  window.TalkEvalBoot={
    ready(){if(done)return;done=true;clearTimeout(timer);root.classList.remove('v18-boot');document.querySelector('#site-startup')?.remove();},
    fail(reason){if(done)return;message(reason||'页面尚未载入完成，请重试。');const button=document.querySelector('[data-startup-retry]');if(button)button.hidden=false;}
  };
  const timer=setTimeout(()=>window.TalkEvalBoot.fail('载入较慢，请检查网络连接，或重新载入。'),20000);
  document.addEventListener('click',event=>{if(event.target.closest('[data-startup-retry]'))location.reload();});
  window.addEventListener('error',event=>{if(event.target?.tagName==='SCRIPT')window.TalkEvalBoot.fail('页面组件加载失败，请重新载入。');},true);
  window.addEventListener('unhandledrejection',()=>{if(!done)window.TalkEvalBoot.fail('页面暂未准备完成，请重新载入。');});
})();
