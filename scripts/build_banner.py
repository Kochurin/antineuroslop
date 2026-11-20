"""Собирает docs/banner.png и docs/social-preview.png из docs/src/banner.html"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "docs" / "src" / "banner.html").as_uri()

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1600, "height": 800}, device_scale_factor=1)
    page.goto(SRC)
    page.wait_for_load_state("networkidle")
    page.evaluate("document.fonts.ready")
    page.screenshot(path=str(ROOT / "docs" / "banner.png"))
    # Превью для соцсетей GitHub: 1280x640
    page2 = browser.new_page(viewport={"width": 1600, "height": 800}, device_scale_factor=0.8)
    page2.goto(SRC)
    page2.wait_for_load_state("networkidle")
    page2.evaluate("document.fonts.ready")
    page2.screenshot(path=str(ROOT / "docs" / "social-preview.png"))
    browser.close()
print("ok")
