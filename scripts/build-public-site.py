#!/usr/bin/env python3
"""Build the public product page and a browsable copy of repository Markdown.

No application bundle, generated credentials, .git files, or node_modules are
published. Markdown remains authoritative; this build only renders it.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import struct
import subprocess
import unicodedata
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, urlunsplit
from xml.sax.saxutils import escape

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parents[1]
BASE = "/fieldops3600/"
CANONICAL = "https://tousif-anwar.github.io" + BASE
SOURCE = "https://github.com/tousif-anwar/fieldops3600"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".avif"}
MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | {".webm", ".mp4", ".pdf"}


def repository_files() -> set[Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
        capture_output=True,
        check=True,
    )
    return {
        ROOT / name
        for name in result.stdout.decode("utf-8").split("\0")
        if name and (ROOT / name).is_file()
    }


def slug(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).strip().lower()
    text = re.sub(r"[^\w\-\s]", "", text)
    return re.sub(r"\s", "-", text)


def image_size(source: Path) -> tuple[int, int] | None:
    if source.suffix.lower() == ".png":
        with source.open("rb") as image:
            header = image.read(24)
        if header.startswith(b"\x89PNG\r\n\x1a\n"):
            return struct.unpack(">II", header[16:24])
    if source.suffix.lower() == ".svg":
        text = source.read_text(encoding="utf-8")
        match = re.search(r'viewBox=[\'\"][-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)[\'\"]', text)
        if match:
            return round(float(match[1])), round(float(match[2]))
    return None


def document_shell(title: str, content: str, relative: Path) -> str:
    name = html.escape(title)
    canonical = CANONICAL + quote(relative.as_posix())
    original = SOURCE + "/blob/main/" + quote(relative.with_suffix(".md").as_posix())
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{name} · FieldOps 360 documentation</title>
  <meta name="description" content="{name}: FieldOps 360 implementation, operation, and engineering documentation.">
  <link rel="canonical" href="{canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="{name} · FieldOps 360">
  <meta property="og:url" content="{canonical}">
  <meta property="og:image" content="{CANONICAL}assets/social-preview.png">
  <meta name="theme-color" content="#f7f8fa">
  <link rel="icon" href="{BASE}assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="{BASE}tokens.css">
  <link rel="stylesheet" href="{BASE}docs.css">
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="docs-header">
    <a class="wordmark" href="{BASE}">FieldOps <strong>360</strong></a>
    <nav aria-label="Documentation navigation">
      <a href="{BASE}#product">Product</a>
      <a href="{BASE}docs/README.html">Documentation</a>
      <a href="{SOURCE}">GitHub</a>
    </nav>
  </header>
  <main id="main" class="document" tabindex="-1">
    <div class="document-context"><a href="{BASE}docs/README.html">Documentation</a><a href="{original}">View Markdown source</a></div>
    <article>{content}</article>
  </main>
  <footer class="docs-footer">FieldOps 360 · Engineering demonstration · Synthetic records only</footer>
</body>
</html>
'''


class References(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.references: list[tuple[str, str]] = []
        self.ids: set[str] = set()
        self.duplicate_ids: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("id"):
            identifier = str(values["id"])
            if identifier in self.ids:
                self.duplicate_ids.append(identifier)
            self.ids.add(identifier)
        for attribute in ("href", "src", "poster"):
            if values.get(attribute):
                self.references.append((tag, str(values[attribute])))
        if values.get("srcset"):
            for candidate in str(values["srcset"]).split(","):
                self.references.append((tag, candidate.strip().split(" ")[0]))


def validate(output: Path) -> tuple[int, list[str]]:
    documents: dict[Path, References] = {}
    failures: list[str] = []
    checked = 0
    for page in output.rglob("*.html"):
        parser = References()
        parser.feed(page.read_text(encoding="utf-8"))
        documents[page.resolve()] = parser
    for page, parser in documents.items():
        for identifier in parser.duplicate_ids:
            failures.append(f"{page.relative_to(output)}: duplicate id {identifier}")
        for _, target in parser.references:
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc:
                continue
            checked += 1
            if parsed.path.startswith("/"):
                if not parsed.path.startswith(BASE):
                    failures.append(f"{page.relative_to(output)}: path escapes base: {target}")
                    continue
                destination = output / unquote(parsed.path[len(BASE) :])
            else:
                destination = page.parent / unquote(parsed.path) if parsed.path else page
            if destination.is_dir():
                destination /= "index.html"
            destination = destination.resolve()
            if not destination.is_relative_to(output.resolve()) or not destination.is_file():
                failures.append(f"{page.relative_to(output)}: missing {target}")
                continue
            if parsed.fragment and destination in documents:
                fragment = unquote(parsed.fragment)
                if fragment not in documents[destination].ids:
                    failures.append(f"{page.relative_to(output)}: missing fragment {target}")
    return checked, failures


def build(output: Path) -> dict[str, object]:
    output = output.resolve()
    expected = (ROOT / ".local/public-site/fieldops3600").resolve()
    if output != expected or not output.is_relative_to(ROOT.resolve()):
        raise ValueError(f"Build output must be the dedicated directory {expected}")
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    website = ROOT / "website"
    if not (website / "index.html").is_file():
        raise ValueError("website/index.html is required")
    website_sources = [*website.glob("*"), *(website / "assets").rglob("*")]
    for source in website_sources:
        if source.is_file() and source.suffix in {".html", ".css", ".js"} | MEDIA_EXTENSIONS:
            destination = output / source.relative_to(website)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)

    files = repository_files()
    markdown = sorted(path for path in files if path.suffix.lower() == ".md")
    fallback_links: list[str] = []
    copied_media: set[Path] = set()
    md = MarkdownIt("commonmark", {"html": False, "linkify": False}).enable("table").enable("strikethrough")
    for rule in ("fence", "code_block"):
        original = md.renderer.rules[rule]

        def focusable_code(tokens, index, options, env, render=original):
            return render(tokens, index, options, env).replace("<pre>", '<pre tabindex="0">', 1)

        md.renderer.rules[rule] = focusable_code

    def rewrite(target: str, source: Path, image: bool = False) -> str:
        parts = urlsplit(target)
        if parts.scheme or parts.netloc or not parts.path:
            return target
        local = (source.parent / unquote(parts.path)).resolve()
        if not local.is_relative_to(ROOT):
            raise ValueError(f"{source.relative_to(ROOT)}: repository link escapes root: {target}")
        relative = local.relative_to(ROOT)
        if local in files and local.suffix.lower() == ".md":
            return urlunsplit(("", "", BASE + quote(relative.with_suffix(".html").as_posix()), parts.query, parts.fragment))
        if local in files and local.suffix.lower() in MEDIA_EXTENSIONS:
            destination = output / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if local not in copied_media:
                shutil.copy2(local, destination)
                copied_media.add(local)
            return urlunsplit(("", "", BASE + quote(relative.as_posix()), parts.query, parts.fragment))
        if image:
            raise ValueError(f"{source.relative_to(ROOT)}: missing or untracked image: {target}")
        # Code, directories, and historic presentation references stay linked to
        # the repository rather than publishing unrelated application source.
        if not local.exists():
            if not source.relative_to(ROOT).as_posix().startswith("docs/presentation/"):
                raise ValueError(f"{source.relative_to(ROOT)}: missing source reference: {target}")
            fallback_links.append(f"{source.relative_to(ROOT).as_posix()}: {target}")
            return SOURCE + "/blob/main/" + quote(source.relative_to(ROOT).as_posix())
        kind = "tree" if local.is_dir() else "blob"
        return SOURCE + f"/{kind}/main/" + quote(relative.as_posix()) + ("#" + parts.fragment if parts.fragment else "")

    for source in markdown:
        tokens = md.parse(source.read_text(encoding="utf-8"))
        heading_ids: set[str] = set()
        title = source.stem.replace("_", " ").title()
        for index, token in enumerate(tokens):
            if token.type == "heading_open":
                inline = tokens[index + 1]
                text = "".join(child.content for child in inline.children or [] if child.type in {"text", "code_inline"})
                key = slug(text)
                identifier = key
                suffix = 0
                while identifier in heading_ids:
                    suffix += 1
                    identifier = f"{key}-{suffix}"
                heading_ids.add(identifier)
                token.attrSet("id", identifier)
                if token.tag == "h1":
                    title = text
            if token.type == "table_open":
                token.attrSet("tabindex", "0")
            for child in token.children or []:
                if child.type == "link_open" and child.attrGet("href"):
                    original_target = str(child.attrGet("href"))
                    previous_fallbacks = len(fallback_links)
                    child.attrSet("href", rewrite(original_target, source))
                    if len(fallback_links) != previous_fallbacks:
                        child.attrSet("title", f"Historical reference unavailable ({original_target}); view its source context")
                elif child.type == "image" and child.attrGet("src"):
                    original_src = str(child.attrGet("src"))
                    child.attrSet("src", rewrite(original_src, source, image=True))
                    child.attrSet("loading", "lazy")
                    child.attrSet("decoding", "async")
                    parts = urlsplit(original_src)
                    if not parts.scheme and not parts.netloc:
                        dimensions = image_size((source.parent / unquote(parts.path)).resolve())
                        if dimensions:
                            child.attrSet("width", str(dimensions[0]))
                            child.attrSet("height", str(dimensions[1]))
        relative = source.relative_to(ROOT).with_suffix(".html")
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(document_shell(title, md.renderer.render(tokens, md.options, {}), relative), encoding="utf-8")

    (output / ".nojekyll").write_text("", encoding="utf-8")
    (output / "robots.txt").write_text(f"User-agent: *\nAllow: {BASE}\nSitemap: {CANONICAL}sitemap.xml\n", encoding="utf-8")
    urls = [CANONICAL] + [CANONICAL + quote(path.relative_to(output).as_posix()) for path in sorted(output.rglob("*.html")) if path != output / "index.html"]
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    sitemap += "".join(f"  <url><loc>{escape(url)}</loc></url>\n" for url in urls) + "</urlset>\n"
    (output / "sitemap.xml").write_text(sitemap, encoding="utf-8")
    checked, failures = validate(output)
    if failures:
        raise ValueError("Public-site link validation failed:\n" + "\n".join(failures))
    summary: dict[str, object] = {
        "output": str(output.relative_to(ROOT)),
        "base_path": BASE,
        "markdown_documents": len(markdown),
        "copied_document_media": len(copied_media),
        "local_references_checked": checked,
        "preexisting_missing_source_references": fallback_links,
        "total_bytes": sum(path.stat().st_size for path in output.rglob("*") if path.is_file()),
    }
    (output.parent / "build-report.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".local/public-site/fieldops3600")
    args = parser.parse_args()
    try:
        print(json.dumps(build(args.output), indent=2))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(str(error))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
