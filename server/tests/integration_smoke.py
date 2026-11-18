"""End-to-end original site + causal motion + slides + presenter client."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/stage-v10';OUT.mkdir(exist_ok=True)
PPT=Path(r'D:\聊天记录\xwechat_files\wxid_hkqc6s0174hs12_a9ae\temp\RWTemp\2026-11\c730f4057a4c1f3eea15dd471ba2f648\TalkEval++ 溢于言表队 5分钟答辩预览.pptx')
checks={};errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True,args=['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'])
    context=browser.new_context(viewport={'width':1440,'height':1100})
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:8765/',wait_until='domcontentloaded')
    page.wait_for_function('window.TalkEvalIntegration?.getReplay()?.view.avatar?.avatars && window.TalkEvalIntegration.getState()?.motion.ready')
    def state():return page.evaluate('TalkEvalIntegration.getState()')
    initial=state();assert initial['caseId']=='speech_004_whales' and initial['motion']['at']<=initial['at']
    assert initial['motion']['cached'] and len(initial['motion']['future'])==40
    assert page.locator('#case-video').get_attribute('src')=='/stage-media/speech_004_whales'
    assert page.locator('#launch-stage .v9-slides').bounding_box()['x']<page.locator('#launch-stage .v9-coach').bounding_box()['x']
    checks['original_case_and_same_clock']=True
    page.screenshot(path=str(OUT/'integrated-stage.png'),full_page=True)
    with context.expect_page() as opened:
        page.locator('#launch-stage [data-ui="presenter"]').click()
    presenter=opened.value;presenter.on('pageerror',lambda e:errors.append(str(e)))
    presenter.wait_for_function('window.__presenterState?.()?.motion.ready')
    assert presenter.locator('video').count()==0 and presenter.locator('.v9-slides').count()==0
    assert presenter.evaluate('__presenterState().caseId')==initial['caseId']
    presenter.set_viewport_size({'width':1100,'height':950})
    presenter.screenshot(path=str(OUT/'presenter.png'),full_page=True)
    checks['presenter_separate_view']=True
    page.bring_to_front()
    options=page.locator('#launch-stage .v9-options');options.locator('summary').click()
    options.locator('[data-setting="history"]').select_option('3')
    options.locator('[data-setting="horizon"]').select_option('3')
    page.wait_for_function('TalkEvalIntegration.getState()?.motion.ready && TalkEvalIntegration.getState().motion.history_frames===60 && TalkEvalIntegration.getState().motion.future.length===60')
    presenter.wait_for_function('__presenterState()?.settings.horizon==="3" && __presenterState()?.settings.history==="3"')
    checks['settings_propagate']=True
    options.locator('[data-setting="goal"]').select_option('open')
    page.wait_for_function('TalkEvalIntegration.getState()?.motion.ready')
    page.locator('#launch-stage [data-mode="practice"]').click()
    frozen=page.evaluate('TalkEvalIntegration.getReplay().view.practice.current')
    page.locator('#case-video').evaluate('(v)=>{v.muted=true;v.play()}')
    page.wait_for_timeout(1600)
    assert page.evaluate('TalkEvalIntegration.getReplay().view.practice.current')==frozen
    page.locator('#case-video').evaluate('(v)=>v.pause()')
    page.locator('#launch-stage [data-mode="prediction"]').click()
    options.locator('summary').click()
    checks['practice_start_stays_fixed']=True
    # Rewind removes both future content evidence and the old forecast immediately.
    page.locator('#case-video').evaluate('(v)=>v.currentTime=10')
    page.wait_for_function('TalkEvalIntegration.getState()?.at<11 && !TalkEvalIntegration.getState()?.motion.ready')
    page.wait_for_timeout(600)
    assert page.evaluate('TalkEvalLaunch.getReplayMonitor().result.units.every(u=>u.time_span[1]<=document.querySelector("#case-video").currentTime)')
    assert not page.locator('#launch-stage .v9-slide-stage>img').is_visible()
    checks['rewind_clears_motion_and_future_evidence']=True
    # Recover real-time pose from an uncached part of this same recording.
    page.locator('#case-video').evaluate('(v)=>{v.currentTime=800;v.muted=true;v.play()}')
    page.wait_for_function('TalkEvalIntegration.getState()?.motion.ready && !TalkEvalIntegration.getState().motion.cached',timeout=45000)
    realtime=state();checks['uncached_recording_live_pose']={'source':realtime['motion']['source'],'processing_ms':realtime['motion']['processing_ms']}
    page.locator('#case-video').evaluate('(v)=>v.pause()')
    # PPTX rendering imports the user's actual eight-page deck, without editing it.
    page.locator('#launch-stage .v9-slides input[type="file"]').set_input_files(str(PPT))
    page.wait_for_function('/已导入8页|导入失败/.test(document.querySelector("#launch-stage [data-slide-status]").textContent)',timeout=180000)
    assert '已导入8页' in page.locator('#launch-stage [data-slide-status]').inner_text()
    page.locator('#launch-stage [data-slide="1"]').click()
    mark_time=page.locator('#case-video').evaluate('(v)=>v.currentTime')
    page.locator('#launch-stage [data-slide-mark]').click()
    page.locator('#launch-stage .v9-follow input').check()
    page.locator('#case-video').evaluate('(v)=>v.currentTime=5')
    page.wait_for_function("document.querySelectorAll('#launch-stage [data-slide]')[0].getAttribute('aria-pressed')==='true'")
    page.locator('#case-video').evaluate('(v,t)=>v.currentTime=t',mark_time+.1)
    page.wait_for_function("document.querySelectorAll('#launch-stage [data-slide]')[1].getAttribute('aria-pressed')==='true'")
    checks['pptx_import_and_marked_page_sync']={'pages':8,'second_page_start':mark_time}
    page.locator('#launch-stage [data-slide-restore]').click()
    # Change case while presenter is connected: no old motion or old content survives.
    page.evaluate('TalkEvalReplay.selectCase("speech_002_pressure_white_hair",{at:38.2,playing:false})')
    page.wait_for_function('TalkEvalIntegration.getState()?.caseId==="speech_002_pressure_white_hair" && TalkEvalIntegration.getState()?.motion.ready',timeout=30000)
    presenter.wait_for_function('__presenterState()?.caseId==="speech_002_pressure_white_hair"')
    assert page.locator('#case-video').get_attribute('src')=='/stage-media/speech_002_pressure_white_hair'
    checks['case_change_and_presenter_follow']=True
    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(700)
    overflow=page.evaluate('document.documentElement.scrollWidth-innerWidth')
    assert overflow<=2,overflow
    page.screenshot(path=str(OUT/'mobile-stage.png'),full_page=True)
    checks['mobile_no_horizontal_overflow']=True
    # Closing the sender makes the client visibly stop displaying actionable cues.
    page.close();presenter.wait_for_timeout(6200)
    assert presenter.locator('#presenter-coach').get_attribute('class').find('v9-disconnected')>=0
    checks['disconnect_stops_prompts']=True
    assert not errors,errors
    browser.close()
(OUT/'integration-browser-checks.json').write_text(json.dumps({'checks':checks,'page_errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(checks,ensure_ascii=False,indent=2))
