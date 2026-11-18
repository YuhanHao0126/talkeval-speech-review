"""The live practice start stays fixed while camera results continue arriving."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True,args=['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',f'--use-file-for-fake-video-capture={ROOT/"artifacts/fake-camera.y4m"}'])
    page=b.new_page(viewport={'width':1440,'height':1100},permissions=['camera']);ready=[];errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    def response(r):
        if '/api/live/' in r.url and r.request.method=='POST':
            value=r.json()
            if value.get('ready'):ready.append(value)
    page.on('response',response)
    page.goto('http://127.0.0.1:8765/lab/?view=review-v8&debug=1',wait_until='networkidle')
    page.wait_for_function("document.querySelector('#stage').dataset.avatarReady==='true' && !document.querySelector('#preview').disabled")
    page.locator('#live-button').click()
    page.wait_for_function("document.querySelector('#source-title').textContent==='摄像头 · 过去2秒观测'",timeout=60000)
    # Real model responses arrive slowly; display should interpolate between them.
    samples=page.evaluate('''()=>new Promise(resolve=>{let values=[],start=performance.now();function step(now){const d=__talkevalDiagnostics();if(d.frame)values.push({pose:d.frame.pose,anchor:d.frame.anchor_seconds});if(now-start<1000)requestAnimationFrame(step);else resolve(values);}requestAnimationFrame(step);})''')
    anchors=len({x['anchor'] for x in samples});poses=len({json.dumps(x['pose']) for x in samples})
    assert poses>anchors,(poses,anchors)
    page.locator('#stage-purpose').select_option('practice')
    page.locator('#practice-capture').click()
    frozen=page.evaluate('__talkevalDiagnostics().practice');count=len(ready)
    page.locator('#practice-play').click();page.wait_for_timeout(1200)
    state=page.evaluate('__talkevalDiagnostics()')
    assert state['practice']==frozen
    assert len(ready)>count and state['frame']['phase']>0
    assert page.locator('#video').evaluate('(v)=>!v.paused')
    assert state['frame']['visibleAvatars']==1
    page.locator('#practice-end').click()
    assert page.locator('#video').evaluate('(v)=>!v.paused')
    page.locator('#stage-panel').screenshot(path=str(ROOT/'artifacts/review-v8/live-practice.png'))
    page.locator('#live-button').click()
    assert page.locator('#video').evaluate('(v)=>v.srcObject===null')
    assert page.locator('#stage-purpose option[value=review]').evaluate('(o)=>o.disabled'),page.locator('#status').inner_text()
    page.locator('#sample-button').click()
    page.wait_for_function("!document.querySelector('#preview').disabled")
    assert page.locator('#stage-purpose option[value=review]').evaluate('(o)=>!o.disabled')
    assert not errors,errors
    result={'source':'Chrome local fake camera, not physical webcam','live_display_poses':poses,'live_observation_anchors':anchors,'practice_start_unchanged_across_live_updates':True,'camera_keeps_playing_during_practice':True,'stop_camera_disables_unavailable_review':True,'errors':errors}
    (ROOT/'artifacts/review-v8/live-practice-checks.json').write_text(json.dumps(result,indent=2),'utf-8');print(json.dumps(result))
    b.close()
