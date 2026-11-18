from pathlib import Path
import io
import json

import numpy as np
from PIL import Image

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        headless=True,
        args=["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
    )
    page = browser.new_page(viewport={"width": 1440, "height": 1150}, device_scale_factor=1)
    failures = []
    page.on("pageerror", lambda error: failures.append(str(error)))
    page.on("response", lambda response: failures.append(f"HTTP {response.status}: {response.url}") if response.status >= 400 else None)
    page.goto("http://127.0.0.1:8765", wait_until="networkidle")
    page.wait_for_function("document.getElementById('stage').dataset.avatarReady === 'true'")
    assert page.locator("#view-avatar").get_attribute("aria-pressed") == "true"
    assert page.locator("#pose-quality").inner_text().strip()
    stage_image = Image.open(io.BytesIO(page.locator("#stage").screenshot())).convert("RGB")
    width, height = stage_image.size
    centre = stage_image.crop((int(width * 0.25), int(height * 0.15), int(width * 0.75), int(height * 0.8)))
    assert (np.asarray(centre).max(axis=-1) < 170).sum() > 2000, "人物应实际绘制到画面中"
    assert page.locator("#stage").get_attribute("data-quality") == "hd"
    page.screenshot(path=str(ARTIFACTS / "avatar-desktop.png"), full_page=True)
    page.locator("#stage").screenshot(path=str(ARTIFACTS / "avatar-preview.png"))
    page.locator("#reveal").check()
    assert page.locator("#comparison-labels").is_visible()
    page.locator("#stage").screenshot(path=str(ARTIFACTS / "avatar-comparison.png"))
    page.locator("#reveal").uncheck()
    page.locator("#camera-view").select_option("full")
    page.locator("#stage").screenshot(path=str(ARTIFACTS / "avatar-full.png"))
    page.locator("#camera-view").select_option("detail")
    page.locator("#stage").screenshot(path=str(ARTIFACTS / "avatar-hd-detail.png"))
    page.locator("#avatar-quality").select_option("standard")
    page.wait_for_function("document.getElementById('stage').dataset.quality === 'standard'")
    page.locator("#avatar-quality").select_option("hd")
    page.wait_for_function("document.getElementById('stage').dataset.quality === 'hd'")
    page.locator("#camera-view").select_option("portrait")
    page.locator("#view-skeleton").click()
    assert page.locator("#stage").get_attribute("data-mode") == "skeleton"
    assert not page.locator("#pose-quality").is_visible()
    page.locator("#view-avatar").click()
    page.locator("#preview").click()
    page.wait_for_function("document.getElementById('forecast-time').textContent === '+0.50s'")
    page.locator("#fullscreen").click()
    page.wait_for_function("document.fullscreenElement?.id === 'stage-panel'")
    page.locator("#stage").screenshot(path=str(ARTIFACTS / "avatar-fullscreen.png"))
    page.evaluate("document.exitFullscreen()")
    page.wait_for_function("document.fullscreenElement === null")
    page.set_viewport_size({"width": 390, "height": 900})
    page.screenshot(path=str(ARTIFACTS / "avatar-mobile.png"), full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.locator("#reveal").check()
    page.locator("#stage").screenshot(path=str(ARTIFACTS / "avatar-mobile-comparison.png"))
    result = page.evaluate("""async () => {
        const THREE = await import('/static/vendor/three.module.js');
        const { GLTFLoader } = await import('/static/vendor/loaders/GLTFLoader.js');
        const { SpeakerAvatar } = await import('/static/avatar.js');
        const loaded = await new GLTFLoader().loadAsync('/static/avatar/speaker.glb');
        const avatar = new SpeakerAvatar(loaded.scene);
        const positions = [[0,0.52,0.46],[0.5,0,0],[-0.5,0,0],[1,0.4,0.1],[-0.8,-0.5,0.1],[1.15,0.95,0.4],[-0.6,-0.7,0.7],[0.3,-1,0],[-0.3,-1,0]];
        const observed = Array(9).fill(1);
        avatar.update(positions, observed);
        let maximumLengthChange = 0;
        let minimumDirectionAlignment = 1;
        for (const arm of avatar.arms) {
            const shoulder = arm.upper.getWorldPosition(new THREE.Vector3());
            const elbow = arm.lower.getWorldPosition(new THREE.Vector3());
            const wrist = arm.hand.getWorldPosition(new THREE.Vector3());
            maximumLengthChange = Math.max(maximumLengthChange, Math.abs(shoulder.distanceTo(elbow)-arm.upperLength), Math.abs(elbow.distanceTo(wrist)-arm.lowerLength));
            const [shoulderIndex, elbowIndex] = arm.side === 'L' ? [1,3] : [2,4];
            const expected = new THREE.Vector3(...positions[elbowIndex]).sub(new THREE.Vector3(...positions[shoulderIndex])).normalize();
            minimumDirectionAlignment = Math.min(minimumDirectionAlignment, elbow.sub(shoulder).normalize().dot(expected));
        }
        const first = [...avatar.bones.values()].map(bone => bone.quaternion.toArray());
        avatar.update(positions, Array(9).fill(0));
        const missingNeutral = avatar.lastQuality.neutral;
        avatar.update(positions, observed);
        const repeated = [...avatar.bones.values()].map(bone => bone.quaternion.toArray());
        const deterministic = JSON.stringify(first) === JSON.stringify(repeated);
        const occludedElbows = observed.slice(); occludedElbows[3]=0; occludedElbows[4]=0;
        avatar.update(positions, occludedElbows);
        const inferredElbows = avatar.lastQuality.inferred;
        const allFinite = [...avatar.bones.values()].every(bone => bone.quaternion.toArray().every(Number.isFinite));
        return {maximumLengthChange, minimumDirectionAlignment, missingNeutral, deterministic, inferredElbows, allFinite};
    }""")
    assert result["maximumLengthChange"] < 0.00001, result
    assert result["minimumDirectionAlignment"] > 0.999, result
    assert result["missingNeutral"] == 2 and result["inferredElbows"] == 2, result
    assert result["deterministic"] and result["allFinite"], result
    assert not failures, failures
    print(json.dumps({"browser_errors": failures, "retargeting": result, "views": ["avatar", "skeleton", "comparison", "full_body", "fullscreen", "mobile"]}))
    browser.close()
