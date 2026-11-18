from pathlib import Path
import json

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        headless=True,
        args=["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
    )
    page = browser.new_page(viewport={"width": 1440, "height": 1150}, device_scale_factor=1)
    failures = []
    page.on("pageerror", lambda error: failures.append(str(error)))
    page.goto("http://127.0.0.1:8765", wait_until="networkidle")
    options=page.request.get('http://127.0.0.1:8765/api/status').json().get('window_options',{})
    sample=page.request.get('http://127.0.0.1:8765/api/sample?model_profile='+('flexible' if options.get('available') else 'legacy')).json()
    page.wait_for_function("!document.getElementById('preview').disabled")
    assert page.locator("#method").input_value() == ("adaptive" if sample['forecasts'].get('adaptive') else 'gru')
    assert page.locator("#stage canvas").count() == 1
    assert page.locator("#split-label").inner_text() == ("跨演讲者测试片段" if sample.get("training_split") == "test" else "留出测试片段")
    assert not page.locator("#reveal").is_checked()
    page.locator("#preview").click()
    page.wait_for_function("expected=>document.getElementById('forecast-time').textContent===expected",arg=f'+{sample["horizon_frames"]/sample["fps"]:.2f}s')
    page.locator("#reveal").check()
    with page.expect_download() as download_info:
        page.locator("#export").click()
    download = download_info.value
    destination = ARTIFACTS / "export-check.json"
    download.save_as(destination)
    payload = json.loads(destination.read_text(encoding="utf-8"))
    assert len(payload["positions"]) == sample['horizon_frames']
    assert payload["history_seconds"] == sample['history_frames']/sample['fps']
    assert payload["horizon_seconds"] == sample['horizon_frames']/sample['fps']
    page.locator("#method").select_option("velocity")
    page.locator("#method").select_option("gru")
    page.locator("#reveal").uncheck()
    stage_box = page.locator("#stage").bounding_box()
    page.mouse.move(stage_box["x"] + 180, stage_box["y"] + 180)
    page.mouse.down()
    page.mouse.move(stage_box["x"] + 270, stage_box["y"] + 190, steps=8)
    page.mouse.up()
    page.locator("#reset-camera").click()
    page.screenshot(path=str(ARTIFACTS / "desktop.png"), full_page=True)
    page.set_viewport_size({"width": 390, "height": 900})
    page.screenshot(path=str(ARTIFACTS / "mobile.png"), full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.set_viewport_size({"width": 1440, "height": 1150})
    upload_path = ROOT / "data" / "upload-check.mp4"
    if upload_path.exists():
        page.locator("#upload").set_input_files(str(upload_path))
        page.wait_for_function("document.getElementById('source-title').textContent === 'upload-check.mp4'", timeout=120000)
        assert page.locator("#split-label").inner_text() == "新上传片段"
        assert page.locator("#method").input_value() == "gru"
        page.locator("#sample-button").click()
        page.wait_for_function("title => document.getElementById('source-title').textContent === title", arg=sample["title"])
    assert failures == [], failures
    print(json.dumps({"browser_errors": failures, "desktop": "1440px", "mobile": "390px", "export": "passed", "upload": upload_path.exists()}, ensure_ascii=False))
    browser.close()
