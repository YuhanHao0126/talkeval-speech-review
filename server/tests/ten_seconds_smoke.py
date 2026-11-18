"""Exercise 10s controls, genuine endpoint rendering, switching and presenter."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts/ten-seconds-v12';OUT.mkdir(exist_ok=True)
checks={};errors=[]
URL='http://127.0.0.1:8765/site/?case=speech_auto_c2c143e546&at=788.075&history=10&horizon=10&method=gru'
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True,args=['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'])
    page=browser.new_page(viewport={'width':1440,'height':1100});page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL,wait_until='domcontentloaded')
    page.wait_for_function('TalkEvalIntegration?.getReplay()?.view.avatar?.displayedGhosts?.length===3')
    page.wait_for_timeout(700)
    value=page.evaluate('''()=>{const s=TalkEvalIntegration.getReplay(),m=s.motion,a=s.view.avatar;
      return {input:m.at,target:m.target_at,history_frames:m.history_frames,frames:m.future.length,profile:m.model_profile,method:m.method,
        ghost_error:Math.max(...a.displayedGhosts[2].flat().map((v,i)=>Math.abs(v-m.future.at(-1).flat()[i]))),
        label:s.view.host.querySelector('[data-out="motion-timing"]').textContent,
        key:s.view.host.querySelector('[data-out="ghost-key"]').textContent};}''')
    assert value['frames']==value['history_frames']==200 and abs(value['target']-value['input']-10)<1e-9
    assert value['ghost_error']==0 and value['profile']=='extended' and value['method']=='gru'
    assert '+10.00秒' in value['label'] and '+3.3s' in value['key'] and '+6.7s' in value['key']
    checks['ten_second_endpoint']=value
    options=page.locator('#launch-stage .v9-options');options.locator('summary').click()
    for history,horizon,profile in [('5','5','extended'),('2','2','flexible'),('10','10','extended')]:
        options.locator('[data-setting="history"]').select_option(history)
        options.locator('[data-setting="horizon"]').select_option(horizon)
        page.wait_for_function('''([h,f,profile])=>{const m=TalkEvalIntegration.getReplay().motion;return m.ready&&m.history_frames===h*20&&m.future.length===f*20&&m.model_profile===profile;}''',arg=[int(history),int(horizon),profile])
    checks['switch_short_and_long_models']=True
    options.locator('[data-setting="method"]').select_option('adaptive')
    page.wait_for_function('TalkEvalIntegration.getReplay().motion.method==="adaptive"')
    options.locator('[data-setting="method"]').select_option('gru')
    page.wait_for_function('TalkEvalIntegration.getReplay().motion.method==="gru"')
    checks['method_switch']=True
    value=page.evaluate('JSON.parse(localStorage.getItem("talkeval-stage-windows-v12"))')
    assert value==dict(history='10',horizon='10',method='gru');checks['settings_persist']=value
    page.evaluate('TalkEvalIntegration.getReplay().video.muted=true;TalkEvalIntegration.getReplay().video.play()')
    value=page.evaluate('''()=>new Promise(resolve=>{const start=performance.now(),poses=new Set(),anchors=new Set(),delays=[];
      function frame(){const s=TalkEvalIntegration.getReplay(),a=s.view.avatar;if(s.motion.ready){poses.add(JSON.stringify(a.displayed));anchors.add(s.motion.at);delays.push(s.time()-a.displayedAt);}
        if(performance.now()-start<1800)requestAnimationFrame(frame);else resolve({displayed_poses:poses.size,forecast_anchors:anchors.size,max_display_delay_seconds:Math.max(...delays)});}
      requestAnimationFrame(frame);})''')
    assert value['displayed_poses']>value['forecast_anchors']*2 and value['max_display_delay_seconds']<.8,value
    checks['continuous_rendering']=value
    page.evaluate('TalkEvalIntegration.getReplay().video.pause();TalkEvalIntegration.getReplay().video.currentTime=788.075')
    page.wait_for_function('TalkEvalIntegration.getReplay().motion.at===788.075')
    page.wait_for_timeout(700)
    page.locator('#launch-stage .lm-stage-grid').screenshot(path=str(OUT/'ten-second-settings.png'))
    options.locator('summary').click()
    page.locator('#launch-stage .lm-stage-grid').screenshot(path=str(OUT/'ten-second-stage.png'))
    token=page.evaluate('TalkEvalIntegration.getRelay().read_token')
    presenter=browser.new_page(viewport={'width':780,'height':1000});presenter.on('pageerror',lambda e:errors.append(str(e)))
    presenter.goto('http://127.0.0.1:8765/presenter/?session='+token)
    presenter.wait_for_function('document.querySelector("[data-out=motion-timing]")?.textContent.includes("+10.00秒")')
    assert presenter.locator('[data-setting="horizon"]').input_value()=='10'
    assert presenter.locator('[data-setting="horizon"]').is_disabled()
    checks['presenter_receives_ten_seconds']=True;presenter.close()
    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(300)
    assert page.evaluate('document.documentElement.scrollWidth-innerWidth')<=2
    page.screenshot(path=str(OUT/'ten-second-mobile.png'),full_page=True);checks['mobile_layout']=True
    assert not errors,errors
    browser.close()
(OUT/'browser-checks.json').write_text(json.dumps(dict(checks=checks,page_errors=errors,url=URL),ensure_ascii=False,indent=2),'utf-8')
print(json.dumps(checks,ensure_ascii=False,indent=2))
