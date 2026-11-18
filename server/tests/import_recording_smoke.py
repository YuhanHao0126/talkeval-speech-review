"""Own disposable fixture: import, causal replay, update, reload, delete."""
from pathlib import Path
import json
import subprocess
import imageio_ffmpeg
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts/import-v11';OUT.mkdir(exist_ok=True)
clip=OUT/'test-video.mp4'
if not clip.exists():
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-ss','785','-i',str(ROOT/'data/archive-20261030/source-04.mp4'),'-t','9','-vf','scale=640:-2,fps=20','-an','-c:v','libx264','-preset','veryfast','-crf','25','-movflags','+faststart','-y',str(clip)],check=True)
SRT='1\n00:00:00,200 --> 00:00:01,200\n先采集视频，再分析动作。\n\n2\n00:00:04,000 --> 00:00:05,000\n反馈帮助下一次改进。\n'
checks={};errors=[]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True,args=['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'])
    page=b.new_page(viewport={'width':1440,'height':1100});page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:8765/site/',wait_until='domcontentloaded');page.wait_for_function('TalkEvalIntegration?.getReplay()')
    page.locator('#import-recording').click();page.locator('.recording-import').screenshot(path=str(OUT/'import-dialog.png'))
    page.locator('[name="video"]').set_input_files(str(clip));page.locator('[name="topic"]').fill('导入流程测试录像（测试后删除）')
    page.locator('[name="outline"]').fill('采集视频，分析动作\n反馈帮助下一次改进')
    page.locator('[name="subtitle"]').set_input_files({'name':'speech.srt','mimeType':'text/plain','buffer':SRT.encode()})
    page.locator('#import-form [type="submit"]').click()
    page.wait_for_function('TalkEvalIntegration?.getReplay()?.monitor.data.saved_session?.sourceType==="imported_video"',timeout=45000)
    identifier=page.evaluate('TalkEvalIntegration.getReplay().monitor.data.saved_session.id')
    try:
        page.wait_for_function('!document.querySelector(".recording-import").open')
        assert page.locator('#case-list').inner_text().find('导入流程测试录像')>=0
        state=page.evaluate('TalkEvalIntegration.getReplay().monitor.data')
        assert state['video_format']=='mp4' and len(state['expression_map']['units'])==2
        assert state['run_metadata']['asr_backend']=='用户提供的时间字幕'
        page.locator('#case-video').evaluate('(v)=>{v.muted=true;v.play()}')
        page.wait_for_function('TalkEvalIntegration.getReplay().motion.ready',timeout=45000)
        page.locator('#case-video').evaluate('(v)=>v.pause()')
        page.locator('#case-video').evaluate('(v)=>v.currentTime=3')
        page.wait_for_timeout(600)
        units=page.evaluate('TalkEvalIntegration.getReplay().monitor.result.units')
        assert len(units)==1 and units[0]['time_span']==[.2,1.2]
        checks['import_and_actual_pose_prediction']=True;checks['subtitles_released_after_end_time']=True
        page.locator('#case-video').evaluate('(v)=>v.currentTime=6');page.wait_for_timeout(600)
        assert len(page.evaluate('TalkEvalIntegration.getReplay().monitor.result.units'))==2
        page.screenshot(path=str(OUT/'imported-replay.png'),full_page=True)
        page.reload(wait_until='domcontentloaded');page.wait_for_function('TalkEvalIntegration?.getReplay()?.monitor.data.saved_session?.sourceType==="imported_video"')
        assert page.evaluate('TalkEvalIntegration.getReplay().monitor.data.saved_session.id')==identifier
        checks['persistent_case_reload']=True
        page.locator('#edit-recording-materials').click();page.locator('[name="outline"]').fill('新重点：先采集视频')
        page.locator('[name="clearSubtitle"]').check();page.locator('#import-form [type="submit"]').click()
        page.wait_for_function('!document.querySelector(".recording-import").open')
        page.wait_for_function('TalkEvalIntegration.getReplay()?.monitor.data.expression_map.units.length===0')
        assert page.locator('#case-video').get_attribute('src').endswith(identifier+'/video')
        checks['can_update_materials_without_reupload']=True
        page.locator('#case-video').evaluate('(v)=>{v.muted=true;v.play()}');page.wait_for_function('TalkEvalIntegration.getReplay().motion.ready',timeout=45000)
        assert page.evaluate('TalkEvalIntegration.getReplay().monitor.result.units.length')==0
        checks['video_only_motion_no_fabricated_text']=True
        page.locator('#case-video').evaluate('(v)=>v.pause()')
        page.set_viewport_size({'width':390,'height':844});page.locator('#import-recording').click()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert page.locator('.recording-import').bounding_box()['width']<=390
        page.screenshot(path=str(OUT/'mobile-import.png'))
        checks['mobile_dialog']=True
        assert not errors,errors
    finally:
        page.evaluate('async id=>{await TalkEvalShared.request("/api/sessions/"+id,{method:"DELETE"});}',identifier)
    b.close()
(OUT/'browser-checks.json').write_text(json.dumps({'checks':checks,'page_errors':errors},ensure_ascii=False,indent=2),'utf-8')
print(json.dumps(checks,ensure_ascii=False,indent=2))
