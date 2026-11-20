"""Картинки для Chrome Web Store и addons.mozilla.org: docs/store/*.png (скриншоты 1280x800, плитка 440x280)"""
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
OUT = DOCS / "store"
OUT.mkdir(exist_ok=True)
SRC = (DOCS / "src" / "store.html").as_uri()

SHOTS = [
    ("1-pole.png", "screen-textarea.png", 560, "Штампы видно<span>пока пишешь</span>",
     "Подчёркнутое слово можно нажать: появится пояснение и вариант замены"),
    ("2-chat.png", "screen-chat.png", 560, "Работает<span>в мессенджерах</span>",
     "Telegram Web, Gmail, VK, Threads и любые поля ввода. Текст не уходит из браузера"),
    ("3-razbor.png", "screen-popup.png", 700, "Оценка<span>человечности</span>",
     "Вставьте текст в окно расширения и получите разбор от 0 до 100 с пояснениями"),
]

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    for out, img, hgt, h, txt in SHOTS:
        page.goto(SRC + "?" + urlencode({"img": (DOCS / img).as_uri(), "hgt": hgt, "h": h, "p": txt}))
        page.wait_for_load_state("networkidle")
        page.evaluate("document.fonts.ready")
        page.screenshot(path=str(OUT / out))
    page = browser.new_page(viewport={"width": 440, "height": 280})
    page.goto((DOCS / "src" / "tile.html").as_uri())
    page.wait_for_load_state("networkidle")
    page.screenshot(path=str(OUT / "tile-440x280.png"))
    browser.close()
print("ok")
