"""Actual browser endpoint mapping, interpolated poses, and stable time labels."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts/stage-v10'
errors=[];checks={}
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True,
        args=['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'])
    page=b.new_page(viewport={'width':1440,'height':1100});page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:8765/site/?case=speech_004_whales&at=789.216',wait_until='domcontentloaded')
    page.wait_for_function('TalkEvalIntegration?.getReplay()?.view.avatar?.displayedGhosts?.length===3')
    page.locator('#launch-stage').scroll_into_view_if_needed()
    value=page.evaluate('''()=>{const s=TalkEvalIntegration.getReplay(),m=s.motion,a=s.view.avatar;
      return {input:m.at,target:m.target_at,frames:m.future.length,ghost_error:Math.max(...a.displayedGhosts[2].flat().map((v,i)=>Math.abs(v-m.future.at(-1).flat()[i]))),
        current_error:Math.max(...a.displayed.flat().map((v,i)=>Math.abs(v-m.current.flat()[i]))),label:s.view.host.querySelector('[data-out="motion-timing"]').textContent,
        prediction_differs:JSON.stringify(m.future.at(-1))!==JSON.stringify(m.current)};}''')
    assert value['input']==789.216 and value['target']==791.216 and value['frames']==40
    assert value['ghost_error']==0 and value['current_error']==0 and value['prediction_differs']
    assert '13:11.22' in value['label'] and '+2.00秒' in value['label']
    checks['paused_exact_future_endpoint']=value
    page.evaluate('TalkEvalIntegration.getReplay().video.play()')
    value=page.evaluate('''()=>new Promise(resolve=>{const start=performance.now(),poses=new Set(),anchors=new Set(),delays=[];
      function frame(){const s=TalkEvalIntegration.getReplay(),a=s.view.avatar;if(s.motion.ready){poses.add(JSON.stringify(a.displayed));anchors.add(s.motion.at);delays.push(s.time()-a.displayedAt);}
        if(performance.now()-start<2400)requestAnimationFrame(frame);else resolve({displayed_poses:poses.size,forecast_anchors:anchors.size,max_display_delay_seconds:Math.max(...delays)});}
      requestAnimationFrame(frame);})''')
    assert value['displayed_poses']>value['forecast_anchors']*3,value
    assert value['max_display_delay_seconds']<.8,value
    checks['interpolated_movement_between_inferences']=value
    page.evaluate('TalkEvalIntegration.getReplay().video.pause()')
    page.wait_for_timeout(800)
    assert page.evaluate('''()=>{const s=TalkEvalIntegration.getReplay();return JSON.stringify(s.view.avatar.displayedGhosts[2])===JSON.stringify(s.motion.future.at(-1));}''')
    checks['pause_settles_to_unchanged_forecast']=True
    options=page.locator('#launch-stage .v9-options');options.locator('summary').click()
    options.locator('[data-setting="horizon"]').select_option('3')
    page.wait_for_function('TalkEvalIntegration.getReplay().motion.future?.length===60')
    checks['three_second_target']=page.evaluate('''()=>{const m=TalkEvalIntegration.getReplay().motion;return {input:m.at,target:m.target_at,frames:m.future.length};}''')
    assert abs(checks['three_second_target']['target']-checks['three_second_target']['input']-3)<1e-9
    options.locator('[data-setting="character"]').select_option('female')
    page.wait_for_function('TalkEvalIntegration.getReplay().view.avatar.character==="female"')
    page.wait_for_timeout(900)
    assert page.evaluate('TalkEvalIntegration.getReplay().view.avatar.avatars.predicted===null')
    checks['unused_avatar_not_loaded']=True
    options.locator('[data-setting="character"]').select_option('male')
    options.locator('[data-setting="horizon"]').select_option('2')
    page.evaluate('TalkEvalIntegration.getReplay().video.currentTime=789.216')
    page.wait_for_function('TalkEvalIntegration.getReplay().motion.at===789.216 && TalkEvalIntegration.getReplay().motion.future?.length===40')
    page.wait_for_timeout(700)
    page.locator('#launch-stage .lm-stage-grid').screenshot(path=str(OUT/'timing-details.png'))
    options.locator('summary').click()
    page.locator('#launch-stage .lm-stage-grid').screenshot(path=str(OUT/'final-stage.png'))
    page.screenshot(path=str(OUT/'final-page.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(300)
    assert page.evaluate('document.documentElement.scrollWidth-innerWidth')<=2
    page.screenshot(path=str(OUT/'mobile-timing.png'),full_page=True)
    checks['mobile_layout']=True
    assert not errors,errors
    b.close()
(OUT/'timing-browser-checks.json').write_text(json.dumps({'checks':checks,'page_errors':errors},ensure_ascii=False,indent=2),'utf-8')
print(json.dumps(checks,ensure_ascii=False,indent=2))
