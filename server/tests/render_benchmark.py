"""Reproducible default-view comparison; software WebGL, not webcam latency."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True,args=['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'])
    page=b.new_page(viewport={'width':1440,'height':1100})
    page.add_init_script('''window._draws=0;for(const type of [WebGLRenderingContext,WebGL2RenderingContext]){const original=type.prototype.drawElements;type.prototype.drawElements=function(...args){window._draws++;return original.apply(this,args);};}''')
    page.goto('http://127.0.0.1:8765/lab/?view=review-v8',wait_until='networkidle')
    page.wait_for_function("document.querySelector('#stage').dataset.avatarReady==='true' && !document.querySelector('#preview').disabled")
    results={}
    for quality in ['standard','hd']:
        page.locator('#avatar-quality').select_option(quality)
        page.wait_for_function('!document.querySelector("#avatar-quality").disabled')
        for mode in ['practice','prediction','review']:
            page.locator('#stage-purpose').select_option(mode)
            if quality=='standard' and mode=='practice':
                page.locator('#practice-end').click()
                page.locator('#stage').screenshot(path=str(ROOT/'artifacts/review-v8/report-stage.png'))
            page.locator('#preview').click()
            value=page.evaluate('''()=>new Promise(resolve=>{let times=[],start=null,last=null;window._draws=0;function step(t){if(start===null)start=t;if(last!==null)times.push(t-last);last=t;if(t-start<1800)requestAnimationFrame(step);else{const sorted=[...times].sort((a,b)=>a-b);resolve({raf_fps:times.length*1000/(t-start),p95_interval_ms:sorted[Math.floor(sorted.length*.95)],draw_calls:window._draws,frames:times.length});}}requestAnimationFrame(step);})''')
            results[f'{quality}/{mode}']=value
    result={'environment':'Headless Chrome software WebGL,1440x1100; 1.8s active preview; not physical webcam or user GPU','before_settings':'v7 default 2K, shadows enabled, practice two solid avatars and three trails; prediction trails enabled','after_settings':'v8 default 1K (also measured 2K), shadows disabled, practice one avatar; prediction trails optional/off; review two avatars','results':results}
    (ROOT/'artifacts/review-v8/after-performance.json').write_text(json.dumps(result,indent=2),'utf-8');print(json.dumps(result))
    b.close()
