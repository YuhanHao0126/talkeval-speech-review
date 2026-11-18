"""Reproducible integrated-view profile, explicitly software WebGL."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--label', default='before')
args = parser.parse_args()
out = ROOT / 'artifacts/stage-v10'
out.mkdir(exist_ok=True)
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe', headless=True,
        args=['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width':1440, 'height':1100})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:8765/site/?case=speech_004_whales&at=789.216', wait_until='domcontentloaded')
    page.wait_for_function('TalkEvalIntegration?.getReplay()?.view.avatar?.avatars && TalkEvalIntegration.getState()?.motion.ready')
    page.locator('#launch-stage').scroll_into_view_if_needed()
    page.wait_for_timeout(1800)
    page.evaluate('''() => {
      const s=TalkEvalIntegration.getReplay(),a=s.view.avatar;
      window._profile={monitor:[],evaluate:[],tick:[],avatar:[],render:[],anchors:[],tasks:[]};
      new PerformanceObserver(list=>{for(const e of list.getEntries())_profile.tasks.push(e.duration);}).observe({type:'longtask'});
      function wrap(obj,key,bucket){const fn=obj[key];obj[key]=function(...args){const start=performance.now();const r=fn.apply(this,args);_profile[bucket].push(performance.now()-start);return r;};}
      wrap(s.monitor,'render','monitor');wrap(StageEngine,'evaluate','evaluate');wrap(s,'display','tick');
      wrap(a.renderer,'render','render');
      for(const av of [a.avatars.actual,...a.avatars.ghosts])wrap(av,'update','avatar');
      const old=a.setFrame;a.setFrame=function(f){if(f?.key!==this.frame?.key)_profile.anchors.push({wall:performance.now(),at:s.motion.at,key:f?.key});return old.call(this,f);};
      window._measure=ms=>new Promise(resolve=>{for(const k of Object.keys(_profile))_profile[k]=[];
        const times=[],start=performance.now();let last;
        function frame(t){if(last!=null)times.push(t-last);last=t;if(t-start<ms)requestAnimationFrame(frame);else{
          const stats=a=>{const x=[...a].sort((a,b)=>a-b);return {n:x.length,mean:x.reduce((a,b)=>a+b,0)/(x.length||1),p95:x[Math.floor(x.length*.95)]||0,max:x.at(-1)||0};};
          const anchors=_profile.anchors;
          resolve({raf_fps:times.length*1000/(t-start),frame_ms:stats(times),costs:Object.fromEntries(Object.entries(_profile).filter(([k])=>k!=='anchors').map(([k,v])=>[k,stats(v)])),
            anchor_intervals_ms:stats(anchors.slice(1).map((v,i)=>v.wall-anchors[i].wall)),anchors:anchors.length,triangles:a.renderer.info.render.triangles,draw_calls:a.renderer.info.render.calls,
            state:{at:s.time(),motion_at:s.motion.at,processing_ms:s.motion.processing_ms,ready:s.motion.ready,ghosts:a.avatars.ghosts.length}});
        }}requestAnimationFrame(frame);
      });
    }''')
    results = {'paused':page.evaluate('_measure(3500)')}
    page.evaluate('TalkEvalIntegration.getReplay().video.play()')
    results['playing'] = page.evaluate('_measure(4500)')
    page.evaluate('TalkEvalIntegration.getReplay().video.pause()')
    page.screenshot(path=str(out / (args.label + '-stage.png')), full_page=False)
    # Isolate old semantic work and WebGL without modifying sources.
    page.evaluate('''()=>{const s=TalkEvalIntegration.getReplay();s.video.currentTime=789.216;window._oldMonitor=s.monitor.render;s.monitor.render=()=>s.monitor.result;}''')
    page.wait_for_timeout(600)
    page.evaluate('TalkEvalIntegration.getReplay().video.play()')
    results['playing_without_original_monitor'] = page.evaluate('_measure(3500)')
    page.evaluate('TalkEvalIntegration.getReplay().video.pause()')
    page.evaluate('''()=>{const s=TalkEvalIntegration.getReplay();s.monitor.render=window._oldMonitor;s.video.currentTime=789.216;s.view.avatar.renderer.render=()=>{};}''')
    page.wait_for_timeout(600)
    page.evaluate('TalkEvalIntegration.getReplay().video.play()')
    results['playing_without_gpu_draw'] = page.evaluate('_measure(3500)')
    result = {'environment':'Headless Chrome software WebGL; 1440x1100; single page; not actual GPU/webcam FPS', 'results':results,'errors':errors}
    (out / (args.label + '-performance.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2), 'utf-8')
    print(json.dumps(result, ensure_ascii=False))
    browser.close()
