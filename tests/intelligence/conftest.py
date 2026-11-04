"""Make source importable without installing the service into global Python."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "intelligence"))
# Optional isolated local dependency directory; production uses requirements.txt.
if (ROOT / "intelligence" / ".packages").exists():
    sys.path.insert(0, str(ROOT / "intelligence" / ".packages"))
