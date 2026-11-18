from pathlib import Path
import io
import json

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"


def exported_pose(page):
    with page.expect_download() as pending:
        page.locator("#export").click()
    destination = ARTIFACTS / "character-export.json"
    pending.value.save_as(str(destination))
    return json.loads(destination.read_text(encoding="utf-8"))


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe", headless=True,
                                         args=["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"])
    page = browser.new_page(viewport={"width": 1440, "height": 1150})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("response", lambda response: errors.append(f"HTTP {response.status}: {response.url}") if response.status >= 400 else None)
    page.goto("http://127.0.0.1:8765", wait_until="networkidle")
    page.wait_for_function("document.getElementById('stage').dataset.character === 'male'")
    page.wait_for_function("!document.getElementById('preview').disabled")
    assert page.locator("#stage").get_attribute("data-preference-source") == "default"
    before = exported_pose(page)
    male_image = np.asarray(Image.open(io.BytesIO(page.locator("#stage").screenshot())).convert("RGB"))
    page.locator("#stage").screenshot(path=str(ARTIFACTS / "male-preview.png"))
    page.locator("#avatar-character").select_option("female")
    page.wait_for_function("document.getElementById('stage').dataset.character === 'female'")
    female_image = np.asarray(Image.open(io.BytesIO(page.locator("#stage").screenshot())).convert("RGB"))
    assert float(np.abs(male_image.astype(float)-female_image.astype(float)).mean()) > 2
    assert exported_pose(page) == before
    page.locator("#avatar-character").select_option("auto")
    page.wait_for_function("document.getElementById('stage').dataset.preferenceSource === 'saved_video'")
    page.reload(wait_until="networkidle")
    page.wait_for_function("document.getElementById('stage').dataset.character === 'female'")
    assert page.locator("#avatar-character").input_value() == "auto"
    assert page.locator("#stage").get_attribute("data-preference-source") == "saved_video"
    sample = page.request.get("http://127.0.0.1:8765/static/sample.json").json()
    sample["avatar_preference"] = "male"
    page.route("**/static/sample.json", lambda route: route.fulfill(json=sample))
    page.reload(wait_until="networkidle")
    page.wait_for_function("document.getElementById('stage').dataset.preferenceSource === 'profile'")
    assert page.locator("#stage").get_attribute("data-character") == "male"
    page.locator("#avatar-character").select_option("female")
    page.locator("#avatar-character").select_option("male")
    page.wait_for_function("document.getElementById('stage').dataset.character === 'male' && !document.getElementById('avatar-quality').disabled")
    assert exported_pose(page) == before
    page.locator("#reveal").check()
    page.locator("#stage").screenshot(path=str(ARTIFACTS / "male-comparison.png"))
    page.locator("#reveal").uncheck()
    page.screenshot(path=str(ARTIFACTS / "male-desktop.png"), full_page=True)
    page.set_viewport_size({"width": 390, "height": 900})
    page.screenshot(path=str(ARTIFACTS / "male-mobile.png"), full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert not errors, errors
    print(json.dumps({"errors": errors, "manual_switch": "passed", "preference_reuse": "passed", "profile_priority": "passed", "forecast_unchanged": "passed", "mobile_width": "passed"}))
    browser.close()
