#!/usr/bin/env python3
"""Validate relative links in the maintained Markdown documentation.

The checker works from the project root (the parent of ``scripts/``) so it
supports both the source checkout and the extracted four-directory release.
External URLs, mail links, and pure anchors are intentionally out of scope.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote

HERE = Path(__file__).resolve()
ROOT = HERE.parents[1]
# In the four-directory release this script lives in ``server/scripts`` and the
# docs directory is one level above the server tree.
if not (ROOT / "docs").is_dir() and (HERE.parents[2] / "docs").is_dir():
    ROOT = HERE.parents[2]
LINK = re.compile(r"!?\[[^\]]*\]\(([^)\n]+)\)")
SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
SKIP_PARTS = {
    ".git",
    ".local",
    ".tools",
    ".tmp",
    "artifacts",
    "bin",
    "obj",
    "node_modules",
    ".venv",
    ".packages",
    ".pytest_cache",
    ".ruff_cache",
    "dist",
    "coverage",
    "test-results",
    "playwright-report",
}


def markdown_files() -> list[Path]:
    candidates = [ROOT / "README.md", *sorted((ROOT / "docs").rglob("*.md"))]
    return [
        path
        for path in candidates
        if path.is_file() and not (set(path.relative_to(ROOT).parts) & SKIP_PARTS)
    ]


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
                    f"{document.relative_to(ROOT)}: link escapes project: {raw}"
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
