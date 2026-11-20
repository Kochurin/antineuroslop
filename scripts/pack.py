"""Собирает dist/antineuroslop-<версия>.zip для загрузки в магазины расширений"""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ["manifest.json", "LICENSE"] + [str(p.relative_to(ROOT)).replace("\\", "/") for d in ("src", "popup", "icons") for p in sorted((ROOT / d).rglob("*")) if p.is_file()]

version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
out = ROOT / "dist" / f"antineuroslop-{version}.zip"
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in FILES:
        z.write(ROOT / f, f)
print(out, len(FILES), "файлов")
