"""Check displayed side identities, synchronized clocks, interpolation and practice."""
from pathlib import Path
import json
import os
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/os.environ.get('TALKEVAL_AUDIT_DIR','artifacts/review-v8');OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True,args=['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'])
    page=browser.new_page(viewport={'width':1440,'height':1100});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:8765/lab/?view=review-v8&debug=1',wait_until='networkidle')
    page.wait_for_function("document.querySelector('#stage').dataset.avatarReady==='true' && !document.querySelector('#preview').disabled")
    assert page.locator('#stage-purpose').input_value()=='prediction'
    assert page.locator('#avatar-quality').input_value()=='standard'
    assert not page.locator('#ghosts').is_checked()
    def state():return page.evaluate('__talkevalDiagnostics()')
    def scrub(percent):
        page.locator('#future-scrub').fill(str(percent));page.locator('#future-scrub').dispatch_event('input')
        page.wait_for_function('!document.querySelector("#video").seeking')
    reference=page.evaluate("async()=>await(await fetch('/api/sample?model_profile=flexible&history_seconds=2&horizon_seconds=2')).json()")
    raw=state()['frame']['raw'];anchor=state()['frame']['anchor_seconds'];index=round(anchor*20)
    page.locator('#stage-purpose').select_option('review')
    checks=[]
    for phase in [0,.13,.63,1]:
        scrub(round(phase*100));frame=state()['frame'];at=index+phase*40
        lo=int(at);hi=min(lo+1,len(reference['positions'])-1);fraction=at-lo
        expected=[[a+(b-a)*fraction for a,b in zip(x,y)] for x,y in zip(reference['positions'][lo],reference['positions'][hi])]
        error=max(abs(a-b) for x,y in zip(frame['left'],expected) for a,b in zip(x,y))
        assert error<1e-7,(phase,error)
        assert frame['visibleAvatars']==2 and frame['raw']==raw
        assert abs(page.locator('#video').evaluate('(v)=>v.currentTime')-(anchor+phase*2))<.005
        assert page.locator('#comparison-labels span').nth(0).inner_text().startswith('左 · 录像实测')
        assert page.locator('#comparison-labels span').nth(1).inner_text().startswith('右 · 模型预测')
        if phase==1:assert frame['right']==raw[-1]
        checks.append({'phase':phase,'actual_error':error})
    # The synthetic case catches swapped sides and integer-frame rounding even if
    # the real example happens to stay still. Raw futures remain unchanged.
    synthetic=page.evaluate('''async()=>{
      const {reviewFrame}=await import('/static/presentation.js?v=8');
      const pose=x=>Array.from({length:9},()=>[x,0,0]);
      const d={positions:[pose(0),pose(10),pose(20)],visibility:Array.from({length:3},()=>Array(9).fill(1)),timestamps:[0,.05,.1],fps:20};
      return reviewFrame(d,{anchor:0,positions:[pose(-2),pose(-4)]},.25);
    }''')
    assert synthetic['left'][0][0]==5 and synthetic['right'][0][0]==-1
    page.locator('#preview').click()
    playback=page.evaluate('''()=>new Promise(resolve=>{
      const samples=[],start=performance.now();
      function step(now){const d=__talkevalDiagnostics().frame; samples.push({time:d.seconds,video:document.querySelector('#video').currentTime,anchor:d.anchor_seconds});if(now-start<1500)requestAnimationFrame(step);else resolve(samples);}requestAnimationFrame(step);
    })''')
    assert len({round(x['time'],3) for x in playback})>20
    assert max(abs(x['time']-x['video']) for x in playback)<.09
    assert all(x['anchor']==anchor for x in playback)
    page.wait_for_function('!__talkevalDiagnostics().playing',timeout=10000)
    scrub(63);page.locator('.workspace').screenshot(path=str(OUT/'review.png'))
    page.locator('#stage-purpose').select_option('practice')
    assert state()['frame']['visibleAvatars']==1
    assert not page.locator('#ghost-toggle').is_visible()
    assert page.locator('#practice-controls').is_visible()
    frozen=state()['practice'];assert frozen['hand']=='right'
    for frame in frozen['positions']:
        assert frame[3]==frozen['current'][3] and frame[5]==frozen['current'][5]
    page.locator('#practice-end').click();assert state()['frame']['pose']==frozen['positions'][-1]
    page.locator('#practice-start').click();assert state()['frame']['pose']==frozen['current']
    page.locator('#practice-play').click();page.wait_for_timeout(800)
    assert state()['practice']==frozen
    page.locator('#stage-panel').screenshot(path=str(OUT/'practice.png'))
    page.locator('#practice-hand').select_option('left')
    swapped=state()['practice'];assert swapped['anchor_seconds']==frozen['anchor_seconds']
    assert swapped['current']==frozen['current'] and swapped['positions']!=frozen['positions']
    page.locator('#stage-purpose').select_option('prediction')
    assert state()['frame']['raw']==raw
    # Continuous display between the approximately 4Hz forecast anchor updates.
    page.locator('#play').click()
    rolling=page.evaluate('''()=>new Promise(resolve=>{
      const samples=[],start=performance.now();function step(now){const d=__talkevalDiagnostics();samples.push({pose:d.frame.pose,anchor:d.frame.anchor_seconds,video:document.querySelector('#video').currentTime});if(now-start<1300)requestAnimationFrame(step);else resolve(samples);}requestAnimationFrame(step);
    })''')
    page.locator('#play').click()
    distinct_poses=len({json.dumps(x['pose']) for x in rolling});distinct_anchors=len({x['anchor'] for x in rolling})
    assert distinct_poses>distinct_anchors*2,(distinct_poses,distinct_anchors)
    assert all(x['anchor']<=x['video']+.001 for x in rolling)
    page.locator('#ghosts').check();page.locator('#stage-panel').screenshot(path=str(OUT/'prediction-ghosts.png'))
    assert state()['frame']['visibleAvatars']==4
    page.locator('#ghosts').uncheck()
    page.locator('#stage-purpose').select_option('practice');page.locator('#practice-end').click()
    page.set_viewport_size({'width':390,'height':900})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(OUT/'mobile.png'),full_page=True)
    assert not errors,errors
    result={'errors':errors,'review_mapping':checks,'max_video_sync_error_seconds':max(abs(x['time']-x['video']) for x in playback),'review_advancing_frames':len({round(x['time'],3) for x in playback}),'rolling_distinct_display_poses':distinct_poses,'rolling_distinct_anchors':distinct_anchors,'practice_fixed_start':True,'practice_single_arm':True,'raw_forecasts_unchanged':True,'mobile_overflow':False}
    (OUT/'review-checks.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),'utf-8');print(json.dumps(result))
    browser.close()
