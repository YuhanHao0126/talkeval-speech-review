"""Fake local camera checks real inference, manual text, saving and replay together."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts/stage-v10';OUT.mkdir(exist_ok=True)
errors=[];checks={}
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True,args=['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',f'--use-file-for-fake-video-capture={ROOT/"artifacts/fake-camera.y4m"}'])
    page=b.new_page(viewport={'width':1440,'height':1100},permissions=['camera','microphone']);page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:8765/site/',wait_until='domcontentloaded');page.wait_for_function('window.TalkEvalIntegration?.getCamera()')
    page.locator('#live-tab').click()
    page.locator('#coach-topic').fill('本机双通道连通检查')
    page.locator('#coach-outline').fill('先采集演讲视频，再分析动作。\n反馈帮助下一轮练习改进。')
    page.locator('#coach-outline').dispatch_event('input')
    page.locator('#coach-consent').check();page.locator('#coach-start').click()
    page.wait_for_function('TalkEvalIntegration.getCamera()?.state?.motion?.ready',timeout=60000)
    state=page.evaluate('TalkEvalIntegration.getCamera().state')
    assert state['caseId'].startswith('camera-') and state['motion']['source']=='摄像头画面 · 本机实时识别'
    assert abs(state['motion']['target_at']-state['motion']['at']-2)<1e-9
    assert state['motion']['future_offsets'][0]==.05 and state['motion']['future_offsets'][-1]==2
    checks['fake_camera_actual_model']={'processing_ms':state['motion']['processing_ms'],'capture_fps':state['motion']['capture_fps'],'history_frames':state['motion']['history_frames']}
    page.locator('#coach-manual-text').fill('我们先采集演讲视频，再分析动作。')
    page.locator('#coach-add-text').click();page.wait_for_timeout(800)
    text=page.evaluate('TalkEvalIntegration.getCamera().state.slow.evidence')
    assert '采集演讲视频' in text
    checks['original_slow_channel_receives_text']=True
    page.screenshot(path=str(OUT/'camera-stage.png'),full_page=True)
    identifier=page.evaluate('TalkEvalLaunch.getCameraMonitor().bridge.getState().session.id')
    page.locator('#coach-stop').click();page.wait_for_function('document.querySelector("#coach-save-dialog").open')
    page.locator('[data-draft-action="save"]').click()
    page.wait_for_function('!document.querySelector("#coach-save-dialog").open',timeout=45000)
    saved=page.evaluate('async id=>(await(await fetch("/api/sessions/"+id)).json()).session',identifier)
    assert saved['cloudVideoReady'] and saved['storageScope']=='local_server'
    checks['explicit_save_to_local_service']=True
    page.locator('#review-tab').click()
    page.evaluate('id=>TalkEvalReplay.selectCase("recording_"+id)',identifier)
    page.wait_for_function('TalkEvalIntegration.getState()?.caseId?.startsWith("recording_")')
    assert page.locator('#case-video').count()==1
    page.locator('#case-video').evaluate('(v)=>{v.muted=true;v.play()}')
    page.wait_for_timeout(2500)
    checks['saved_case_replay']=page.locator('#case-video').evaluate('(v)=>v.currentTime')>0
    assert checks['saved_case_replay']
    # Remove only the synthetic test recording created by this script using its own key.
    page.evaluate('async id=>{const keys=JSON.parse(localStorage.getItem("talkeval-shared-owner-keys-v1"));await fetch("/api/sessions/"+id,{method:"DELETE",headers:{"X-Session-Key":keys[id]}})}',identifier)
    assert not errors,errors
    b.close()
(OUT/'integration-camera-checks.json').write_text(json.dumps({'checks':checks,'page_errors':errors,'source':'Chrome fake local video; no physical camera test'},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(checks,ensure_ascii=False,indent=2))
