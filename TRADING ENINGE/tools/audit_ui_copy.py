"""Dump every user-facing string in the app for the unslop scanners.

Interface copy is the app's most-read text, and it is spread across TSX components
and FastAPI response messages. This collects both into one plain-text file so the
vendored `skills/unslop` scanners can read it:

    python tools/audit_ui_copy.py
    python skills/unslop/scripts/banned_phrase_scan.py   < data/tmp/ui-copy.txt
    python skills/unslop/scripts/structure_scan.py       < data/tmp/ui-copy.txt

The scanners suggest candidates; check each hit in context before editing. Numbers,
thresholds and risk wording are content and must survive a rewrite.
"""
from __future__ import annotations

import re
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
EM_DASH = "\u2014"


def frontend_strings() -> list[str]:
    out: list[str] = []
    jsx_text = re.compile(r">([^<>{}]{12,})<")
    literal = re.compile(r"(?<![\w/])(?:\"([^\"\\\n]{8,})\"|'([^'\\\n]{8,})'|`([^`]{8,})`)")
    for path in sorted((ROOT / "frontend/src").rglob("*.ts*")):
        src = path.read_text(encoding="utf-8")
        src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
        src = re.sub(r"^\s*//.*$", "", src, flags=re.M)
        found = [m.group(1) for m in jsx_text.finditer(src)]
        for match in literal.finditer(src):
            groups = [g for g in match.groups() if g]
            if groups:
                found.append(groups[0])
        for text in found:
            text = " ".join(text.split())
            if len(text) < 12 or not re.search(r"[A-Za-z]{3,}\s+[A-Za-z]{2,}", text):
                continue
            out.append("[ui] " + text)
    return out


def backend_messages() -> list[str]:
    out: list[str] = []
    patterns = [
        re.compile(r'(?:message|detail|reason|label|note|caveat|instructions|text)"\s*:\s*f?"([^"]{10,})"'),
        re.compile(r'(?:message|detail)\s*=\s*f?"([^"]{20,})"'),
    ]
    for path in sorted((ROOT / "backend/app").rglob("*.py")):
        src = path.read_text(encoding="utf-8")
        for pattern in patterns:
            for match in pattern.finditer(src):
                out.append("[api] " + " ".join(match.group(1).split()))
    return out


def main() -> int:
    seen: set[str] = set()
    lines: list[str] = []
    for line in frontend_strings() + backend_messages():
        if line not in seen:
            seen.add(line)
            lines.append(line)

    text = "\n".join(lines) + "\n"
    dest = ROOT / "data/tmp/ui-copy.txt"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text, encoding="utf-8")

    print(f"strings collected : {len(lines)}")
    print(f"prose em dashes   : {text.count(EM_DASH)}")
    print(f"' - ' connectors  : {text.count(' - ')}")
    print(f"written to        : {dest.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
