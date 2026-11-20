"""
Проверка расширения в настоящем Chrome
Загружает папку как распакованное расширение (CDP Extensions.loadUnpacked),
печатает текст в textarea, contenteditable и input и проверяет подсветку,
подсказку и замену. Попутно снимает скриншоты в docs/

Запуск: python scripts/e2e.py [--headed]
"""
import sys
import threading
import functools
import tempfile
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
HEADED = "--headed" in sys.argv

SLOP_POST = (
    "В современном мире VPN — это не просто программа, а настоящий незаменимый помощник. "
    "Давайте разберёмся, почему это важно.\n\n"
    "Важно отметить, что данный сервис работает быстро, надёжно и удобно. Результат? Сайты действительно открываются."
)
SLOP_CHAT = "Отличный вопрос! На сегодняшний день мы осуществляем доставку по всей России. Надеюсь, это поможет."
CLEAN_CHAT = "Привет, завтра в семь у метро, я возьму билеты"


def serve(directory):
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(directory))
    handler.log_message = lambda *a, **k: None
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def check(cond, msg):
    print(("  OK  " if cond else "  FAIL ") + msg)
    if not cond:
        check.failed += 1


check.failed = 0


def main():
    srv = serve(ROOT / "tests" / "e2e")
    url = f"http://127.0.0.1:{srv.server_address[1]}/page.html"
    with sync_playwright() as p:
        # Расширения работают только в основном профиле, поэтому persistent context
        ctx = p.chromium.launch_persistent_context(
            tempfile.mkdtemp(prefix="antislop-"),
            channel="chrome",
            headless=not HEADED,
            args=["--enable-unsafe-extension-debugging", "--lang=ru"],
            ignore_default_args=["--disable-extensions"],
            viewport={"width": 900, "height": 760},
            device_scale_factor=2,
            locale="ru-RU",
        )
        browser = ctx.browser
        cdp = browser.new_browser_cdp_session()
        ext_id = cdp.send("Extensions.loadUnpacked", {"path": str(ROOT)})["id"]
        print("Расширение загружено:", ext_id)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(url)

        # ---- textarea ----
        print("textarea")
        ta = page.locator("#ta")
        ta.click()
        ta.press_sequentially(SLOP_POST, delay=2)
        page.wait_for_timeout(700)
        marks = page.evaluate("() => { const r = document.querySelector('antislop-root'); return r ? r.shadowRoot.querySelectorAll('.mirror mark').length : -1 }")
        check(marks >= 6, f"подсвечено штампов в textarea: {marks}")
        badge = page.evaluate("() => document.querySelector('antislop-root').shadowRoot.querySelector('.badge span').textContent")
        check("штамп" in badge, f"значок со счётчиком: {badge}")

        # Клик по «Давайте разберёмся»
        value = ta.input_value()
        idx = value.index("Давайте") + 3
        ta.evaluate(f"el => {{ el.focus(); el.setSelectionRange({idx}, {idx}); }}")
        rect = page.evaluate("() => { const r = document.querySelector('antislop-root').shadowRoot; const m = [...r.querySelectorAll('.mirror mark')].find(x => x.textContent.startsWith('Давайте')); const b = m.getBoundingClientRect(); return {x: b.left + 10, y: b.top + b.height/2}; }")
        page.mouse.click(rect["x"], rect["y"])
        page.wait_for_timeout(300)
        pop = page.evaluate("() => { const p = document.querySelector('antislop-root').shadowRoot.querySelector('.pop'); return p.hidden ? '' : p.innerText }")
        check("Давайте разберёмся" in pop, "по клику открылась подсказка: " + pop.split("\n")[1] if pop else "подсказка не открылась")
        page.screenshot(path=str(DOCS / "screen-textarea.png"))

        # Применяем замену
        page.evaluate("() => document.querySelector('antislop-root').shadowRoot.querySelector('.pop .fx button').click()")
        page.wait_for_timeout(500)
        after = ta.input_value()
        check("Давайте разберёмся" not in after and "Почему это важно" in after, "замена применилась: …" + after[after.find("помощник"):][:60])

        # ---- contenteditable ----
        print("contenteditable")
        ce = page.locator("#ce")
        ce.click()
        ce.press_sequentially(SLOP_CHAT, delay=2)
        page.wait_for_timeout(700)
        hl = page.evaluate("() => { const a = CSS.highlights.get('antislop'); const b = CSS.highlights.get('antislop-strong'); return (a ? a.size : 0) + (b ? b.size : 0) }")
        check(hl >= 4, f"подсвечено штампов в contenteditable: {hl}")
        # Клик по «осуществляем»
        box = page.evaluate("""() => {
          const el = document.getElementById('ce'); const t = el.firstChild; const i = t.data.indexOf('осуществляем');
          const r = document.createRange(); r.setStart(t, i + 2); r.setEnd(t, i + 3); const b = r.getBoundingClientRect();
          return {x: b.left + 1, y: b.top + b.height / 2};
        }""")
        page.mouse.click(box["x"], box["y"])
        page.wait_for_timeout(300)
        pop = page.evaluate("() => { const p = document.querySelector('antislop-root').shadowRoot.querySelector('.pop'); return p.hidden ? '' : p.innerText }")
        check("Канцелярский оборот" in pop, "подсказка в contenteditable")
        page.screenshot(path=str(DOCS / "screen-chat.png"))
        page.evaluate("() => document.querySelector('antislop-root').shadowRoot.querySelector('.pop .fx button').click()")
        page.wait_for_timeout(500)
        txt = ce.inner_text()
        check("делаем доставку" in txt, "замена в contenteditable: " + txt[:80])

        # Чистый текст: ничего не подсвечено
        ce.evaluate("el => { el.textContent = '' }")
        ce.click()
        ce.press_sequentially(CLEAN_CHAT, delay=2)
        page.wait_for_timeout(700)
        hl = page.evaluate("() => { const a = CSS.highlights.get('antislop'); const b = CSS.highlights.get('antislop-strong'); return (a ? a.size : 0) + (b ? b.size : 0) }")
        check(hl == 0, f"живой текст без подсветки: {hl}")

        # ---- input ----
        print("input")
        inp = page.locator("#inp")
        inp.click()
        inp.press_sequentially("Раскройте свой потенциал — это действительно важно", delay=2)
        page.wait_for_timeout(700)
        marks = page.evaluate("() => document.querySelector('antislop-root').shadowRoot.querySelectorAll('.mirror mark').length")
        check(marks >= 2, f"подсвечено в input: {marks}")

        check(not errors, "без ошибок на странице " + "; ".join(errors))

        # ---- окно разбора ----
        print("popup")
        pp = ctx.new_page()
        pp.set_viewport_size({"width": 440, "height": 900})
        pp.goto(f"chrome-extension://{ext_id}/popup/popup.html")
        pp.click("#sample")
        pp.wait_for_timeout(300)
        score = pp.inner_text("#score")
        items = pp.locator("#list li").count()
        check(int(score) < 40 and items >= 8, f"разбор примера: оценка {score}, пунктов {items}")
        pp.locator("#preview mark").nth(3).click()
        pp.wait_for_timeout(200)
        pp.set_viewport_size({"width": 440, "height": 1000})
        pp.evaluate("() => { window.scrollTo(0, 0); document.getElementById('text').scrollTop = 0; }")
        pp.screenshot(path=str(DOCS / "screen-popup.png"))
        pp.click("#autofix")
        pp.wait_for_timeout(200)
        score2 = pp.inner_text("#score")
        check(int(score2) > int(score), f"«Почистить простое» подняло оценку: {score} → {score2}")
        pp.click("#clear")

        ctx.close()
    srv.shutdown()
    print("Провалов:", check.failed)
    sys.exit(1 if check.failed else 0)


if __name__ == "__main__":
    main()
