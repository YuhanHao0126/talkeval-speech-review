"""Exercise real timing controls, preview-only rate, upload reuse and simulated camera."""
from pathlib import Path
import json
import time
import subprocess
import imageio_ffmpeg
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/windows-v6';OUT.mkdir(parents=True,exist_ok=True)
fake=ROOT/'artifacts/fake-camera.y4m'
if not fake.exists():subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-i',str(ROOT/'static/sample.mp4'),'-vf','scale=640:360,fps=15','-t','8','-pix_fmt','yuv420p','-f','yuv4mpegpipe','-y',str(fake)],check=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True,args=['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',f'--use-file-for-fake-video-capture={ROOT/"artifacts/fake-camera.y4m"}'])
    context=browser.new_context(viewport={'width':1440,'height':1100},permissions=['camera'])
    page=context.new_page();errors=[];live=[];exports=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    def on_response(response):
        if '/api/live/' in response.url and response.request.method=='POST':
            try:live.append(response.json())
            except Exception:pass
    page.on('response',on_response)
    page.goto('http://127.0.0.1:8765/lab/?view=windows-v6',wait_until='networkidle')
    page.wait_for_function("document.querySelector('#stage').dataset.avatarReady==='true' && !document.querySelector('#history-seconds').disabled")
    assert page.locator('#history-seconds').input_value()=='2'
    assert page.locator('#horizon-seconds').input_value()=='1'
    assert page.locator('#preview-speed').input_value()=='0.5'
    def set_window(h,f):
        page.locator('#history-seconds').select_option(str(h))
        page.wait_for_function("!document.querySelector('#history-seconds').disabled")
        page.locator('#horizon-seconds').select_option(str(f))
        page.wait_for_function("!document.querySelector('#horizon-seconds').disabled && !document.querySelector('#preview').disabled")
    def exported(name):
        with page.expect_download() as event:page.locator('#export').click()
        destination=OUT/(name+'.json');event.value.save_as(destination)
        return json.loads(destination.read_text('utf-8'))
    for h in [2,3,4]:
        for f in [.5,1,1.5]:
            set_window(h,f);value=exported(f'window-{h}-{f}')
            assert value['history_seconds']==h and value['horizon_seconds']==f
            assert len(value['positions'])==round(f*20) and value['model_profile']=='flexible'
            assert page.locator('#forecast-time').inner_text()==f'+{f:.2f}s'
            assert f'当前 {h}秒 → {f}秒' in page.locator('#adaptive-metric').inner_text()
            assert page.locator('#stage').get_attribute('data-trails')=='true'
            exports.append({'history':h,'horizon':f,'frames':len(value['positions'])})
    set_window(2,1)
    before=exported('before-rate');page.locator('#preview-speed').select_option('0.25')
    after=exported('after-rate');assert before['positions']==after['positions']
    assert '4.0秒播放' in page.locator('#playback-note').inner_text()
    page.locator('#preview-speed').select_option('0.5')
    started=time.perf_counter();page.locator('#preview').click()
    page.wait_for_function("document.querySelector('#stage').dataset.previewing==='false'")
    elapsed=time.perf_counter()-started;assert 1.8<elapsed<5,elapsed
    page.locator('#reveal').check();assert page.locator('#comparison-labels').is_visible();page.locator('#reveal').uncheck()
    page.screenshot(path=str(OUT/'desktop.png'),full_page=True)
    page.locator('#stage-panel').screenshot(path=str(OUT/'ghosts-1s.png'))
    page.set_viewport_size({'width':390,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(OUT/'mobile.png'),full_page=True);page.set_viewport_size({'width':1440,'height':1100})
    # Upload once, then change timing using the already extracted poses.
    upload=ROOT/'static/sample.mp4'
    page.locator('#upload').set_input_files(str(upload))
    page.wait_for_function("document.querySelector('#source-title').textContent==='sample.mp4' && !document.querySelector('#history-seconds').disabled",timeout=120000)
    source=page.locator('#video').get_attribute('src');set_window(4,1.5)
    assert page.locator('#video').get_attribute('src')==source
    assert len(exported('upload-4-1.5')['positions'])==30
    # Live settings can change without recreating camera permission/session.
    page.locator('#live-button').click()
    page.wait_for_function("document.querySelector('#source-title').textContent==='摄像头 · 过去4秒观测'",timeout=90000)
    page.locator('#history-seconds').select_option('3');page.locator('#horizon-seconds').select_option('1')
    page.wait_for_function("document.querySelector('#source-title').textContent==='摄像头 · 过去3秒观测' && document.querySelector('#forecast-time').textContent==='+1.00s'",timeout=30000)
    live_value=exported('live-3-1');assert len(live_value['positions'])==20 and live_value['history_seconds']==3
    assert live_value['snapshot_age_seconds']>=0 and '快照' in live_value['note']
    page.locator('#live-button').click();assert page.evaluate('document.querySelector("#video").srcObject===null')
    page.locator('#sample-button').click();page.wait_for_function("!document.querySelector('#history-seconds').disabled")
    set_window(2,1)
    page.reload(wait_until='networkidle');page.wait_for_function("!document.querySelector('#history-seconds').disabled")
    assert page.locator('#history-seconds').input_value()=='2' and page.locator('#horizon-seconds').input_value()=='1'
    assert not errors,errors
    ready=[r for r in live if r.get('ready')]
    assert any(r['history_frames']==80 and r['horizon_frames']==30 for r in ready)
    assert any(r['history_frames']==60 and r['horizon_frames']==20 for r in ready)
    result=dict(errors=errors,configurations=exports,preview_seconds_for_1s_at_half_speed=elapsed,rate_changes_forecast=False,upload_reused=True,mobile_overflow=False,live_shapes=sorted(set((r['history_frames'],r['horizon_frames']) for r in ready)),camera_source='Chromium local fake video; not physical webcam',settings_persisted=True)
    (OUT/'checks.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result,ensure_ascii=False))
    browser.close()
