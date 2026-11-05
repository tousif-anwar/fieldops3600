#!/usr/bin/env python3
"""Validate relative links and image paths in maintained Markdown.

External URLs, mail links, and pure anchors are intentionally out of scope.
The checker works from tracked/untracked-but-not-ignored files and skips the
pre-existing presentation package, whose ownership is separate from this
repository documentation build.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
LINK = re.compile(r"!?\[[^\]]*\]\(([^)\n]+)\)")
SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
SKIP_PREFIXES = ("docs/presentation/",)


def markdown_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "*.md"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    paths = []
    for name in result.stdout.splitlines():
        normalized = name.replace("\\", "/")
        if normalized.startswith(SKIP_PREFIXES):
            continue
        path = ROOT / normalized
        if path.is_file():
            paths.append(path)
    return sorted(set(paths))


def without_fences(text: str) -> str:
    return re.sub(r"```.*?```", "", text, flags=re.DOTALL)


def main() -> int:
    failures: list[str] = []
    checked = 0
    documents = markdown_files()
    for document in documents:
        text = without_fences(document.read_text(encoding="utf-8", errors="replace"))
        for raw in LINK.findall(text):
            target = raw.strip()
            if not target or target.startswith("#"):
                continue
            if target.startswith("<") and target.endswith(">"):
                target = target[1:-1].strip()
            target = target.split(' "', 1)[0].strip()
            if not target or SCHEME.match(target) or target.startswith("/"):
                continue
            target = unquote(target.split("#", 1)[0].split("?", 1)[0])
            if not target:
                continue
            resolved = (document.parent / target).resolve()
            try:
                resolved.relative_to(ROOT.resolve())
            except ValueError:
                failures.append(
                    f"{document.relative_to(ROOT)}: link escapes repository: {raw}"
                )
                continue
            checked += 1
            if not resolved.exists():
                failures.append(f"{document.relative_to(ROOT)}: missing {target}")

    if failures:
        print(f"Documentation link check failed ({len(failures)} issue(s)):")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print(
        "Documentation link check passed: "
        f"{checked} relative link(s) in {len(documents)} file(s)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
