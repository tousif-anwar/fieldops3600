"""Copy repository inputs (including uncommitted source) without local secrets or dependencies."""
from pathlib import Path
import shutil
import subprocess
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / (".local/security-source-" + uuid4().hex[:12])
files = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=ROOT, text=True).splitlines()
for name in files:
    source = (ROOT / name).resolve()
    source.relative_to(ROOT)
    if not source.is_file():
        continue
    destination = TARGET / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
(ROOT / ".local/security-snapshot-path.txt").write_text(str(TARGET), encoding="utf-8")
print(f"Prepared {len(files)} repository inputs for scanning without ignored generated files.")
