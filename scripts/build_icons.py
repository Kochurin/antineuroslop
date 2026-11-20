"""Рендерит иконки расширения из docs/src/icon.html через Playwright и системный Chrome"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "docs" / "src" / "icon.html").as_uri()

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    for size in (16, 32, 48, 128):
        page = browser.new_page(viewport={"width": 512, "height": 512}, device_scale_factor=size / 512)
        page.goto(SRC)
        page.locator(".i").screenshot(path=str(ROOT / "icons" / f"icon{size}.png"), omit_background=True)
        page.close()
    browser.close()
print("ok")
