"""Central place to read API keys and settings from the environment.

Keys live in a local ``.env`` file (see ``.env.example``) which is gitignored.
Usage::

    from investing.config import settings
    settings.require("POLYGON_API_KEY")   # raises if missing
    settings.get("FRED_API_KEY")          # returns None if missing
"""

from __future__ import annotations

import os
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _ROOT / ".env"


def _load_dotenv(path: Path = _ENV_FILE) -> None:
    """Minimal .env loader (no external dependency). Does not override
    variables that are already set in the real environment."""
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.split(" #", 1)[0].strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


class MissingApiKey(RuntimeError):
    pass


class Settings:
    def __init__(self) -> None:
        _load_dotenv()

    def get(self, name: str, default: str | None = None) -> str | None:
        value = os.environ.get(name, "").strip()
        return value or default

    def require(self, name: str) -> str:
        value = self.get(name)
        if not value:
            raise MissingApiKey(
                f"{name} is not set. Copy .env.example to .env and fill it in."
            )
        return value

    def bool(self, name: str, default: bool = False) -> bool:
        value = self.get(name)
        if value is None:
            return default
        return value.lower() in {"1", "true", "yes", "on"}

    def int(self, name: str, default: int) -> int:
        value = self.get(name)
        return int(value) if value else default


settings = Settings()
