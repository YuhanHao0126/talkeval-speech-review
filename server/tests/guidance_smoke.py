"""End-to-end browser checks: trails, evidence, live frame pipeline via fake camera."""
from pathlib import Path
import json
import subprocess
import time
import imageio_ffmpeg
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARTIFACTS=ROOT/'artifacts';ARTIFACTS.mkdir(exist_ok=True)
y4m=ARTIFACTS/'fake-camera.y4m'
if not y4m.exists():
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-i',str(ROOT/'static/sample.mp4'),'-vf','scale=640:360,fps=15','-t','8','-pix_fmt','yuv420p','-f','yuv4mpegpipe','-y',str(y4m)],check=True)

with sync_playwright() as playwright:
    browser=playwright.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True,args=['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',f'--use-file-for-fake-video-capture={y4m}'])
    context=browser.new_context(viewport={'width':1440,'height':1100},permissions=['camera'])
    page=context.new_page();failures=[];live=[]
    page.on('pageerror',lambda error:failures.append(str(error)))
    def response_received(response):
        if '/api/live/' in response.url and response.request.method=='POST':
            try:live.append(response.json())
            except Exception:pass
    page.on('response',response_received)
    page.goto('http://127.0.0.1:8765',wait_until='networkidle')
    page.wait_for_function("document.querySelector('#stage').dataset.avatarReady === 'true'")
    assert page.locator('#stage').get_attribute('data-trails')=='true'
    assert page.locator('#coverage-value').inner_text()=='66.7%'
    page.locator('#append-example').click();page.wait_for_function("document.querySelector('#coverage-value').textContent==='100.0%'")
    page.locator('#transcript-input').fill('完全无关的句子。');page.locator('#align-button').click();page.wait_for_function("document.querySelector('#coverage-value').textContent==='0.0%'")
    page.locator('#transcript-input').fill('我们先采集演讲视频，再分析手势和表达。例如在课堂展示中，学生可以回看自己的动作。');page.locator('#align-button').click()
    page.wait_for_function("document.querySelector('#coverage-value').textContent==='66.7%'")
    page.screenshot(path=str(ARTIFACTS/'guidance-desktop.png'),full_page=True)
    page.locator('#stage').screenshot(path=str(ARTIFACTS/'ghost-trails.png'))
    page.locator('.slow-panel').screenshot(path=str(ARTIFACTS/'slow-channel.png'))
    def export_to(name):
        with page.expect_download() as info:page.locator('#export').click()
        path=ARTIFACTS/name;info.value.save_as(path);return json.loads(path.read_text('utf-8'))
    first=export_to('trails-on.json')
    page.locator('#ghosts').uncheck();assert page.locator('#stage').get_attribute('data-trails')=='false'
    second=export_to('trails-off.json');assert first['positions']==second['positions']
    page.locator('#ghosts').check();page.locator('#reveal').check()
    assert page.locator('#comparison-labels').is_visible()
    assert page.locator('#stage').get_attribute('data-trails')=='false'
    page.locator('#reveal').uncheck()
    page.set_viewport_size({'width':390,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(ARTIFACTS/'guidance-mobile.png'),full_page=True)
    page.set_viewport_size({'width':1440,'height':1100})
    page.locator('#live-button').click()
    # With software rendering, capture can be slower than on the user's native GPU.
    page.wait_for_function("document.querySelector('#source-title').textContent.startsWith('摄像头 · 过去')",timeout=90000)
    page.wait_for_function("document.querySelector('#status').textContent.includes('实时监测中')",timeout=30000)
    page.screenshot(path=str(ARTIFACTS/'live-guidance.png'),full_page=True)
    assert page.locator('#reveal').is_disabled()
    page.locator('#live-button').click()
    assert page.evaluate('document.querySelector("#video").srcObject===null')
    page.locator('#sample-button').click();page.wait_for_function("!document.querySelector('#preview').disabled")
    assert not failures,failures
    ready=[r for r in live if r.get('ready')]
    assert ready and all(len(r['history'])==r['history_frames'] and len(r['positions'])==r['horizon_frames'] for r in ready)
    report={'browser_errors':failures,'ready_live_responses':len(ready),'processing_ms':[r['processing_ms'] for r in ready],'capture_fps':[r['capture_fps'] for r in ready],
            'camera_source':'Chromium fake video capture from local sample, not physical webcam; software WebGL rendering.','trail_export_unchanged':True,'coverage_checks':[66.7,100,0], 'mobile_width':390}
    (ARTIFACTS/'guidance-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))
    browser.close()
