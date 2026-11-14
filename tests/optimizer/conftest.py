"""Make source importable without installing the service into global Python."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "optimizer"))
# Optional isolated local dependency directory; production uses requirements.txt.
if (ROOT / "optimizer" / ".packages").exists():
    sys.path.insert(0, str(ROOT / "optimizer" / ".packages"))
