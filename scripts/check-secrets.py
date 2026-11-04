"""Small local guard. CI also runs Gitleaks; this is not a replacement."""
from pathlib import Path
import re
import subprocess
import sys

files = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard"], text=True).splitlines()
patterns = [re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
            re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"),
            re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
            re.compile(r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b")]
failures = []
for filename in files:
    path = Path(filename)
    if not path.is_file() or path.stat().st_size > 2_000_000:
        continue
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    if path.name == ".env" or "generated" in path.name and path.suffix in {".sql", ".json"}:
        failures.append(filename + ": generated credentials must remain ignored")
    if any(pattern.search(text) for pattern in patterns):
        failures.append(filename + ": possible credential material")
if failures:
    print("\n".join(failures))
    sys.exit(1)
print(f"Local credential guard passed for {len(files)} repository files.")
