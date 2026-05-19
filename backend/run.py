"""Entry point for local development."""
import sys
import io
import os

# ── MUST be set BEFORE importing uvicorn so all child/reload processes inherit it ──
# PYTHONUTF8=1 forces UTF-8 across the entire interpreter (PEP 540).
# PYTHONIOENCODING ensures stdin/stdout/stderr are UTF-8 even in legacy modes.
os.environ["PYTHONUTF8"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"

# Patch the current process's stdout/stderr for immediate effect
try:
    if hasattr(sys.stdout, "buffer"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "buffer"):
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
except Exception:
    pass  # Already wrapped or no buffer — safe to ignore

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
