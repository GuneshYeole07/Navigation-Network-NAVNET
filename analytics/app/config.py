from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(ROOT / ".env", ROOT.parent / "server" / ".env"), extra="ignore")

    database_url: str = "postgresql://postgres:postgres@localhost:5432/navnet"
    # Shared secret with the NavNet API; requests must send it as X-Analytics-Key.
    analytics_key: str = ""
    model_path: Path = ROOT / "models" / "eta.joblib"
    auto_train: bool = True  # train on startup if there's no model yet
    train_min_trips: int = 5
    # Live safety monitor (crash / unusual movement / weak GPS). Needs the API's
    # SAFETY_MONITOR=1 too, and api_url to send alerts back to.
    safety_monitor: bool = False
    api_url: str = "http://localhost:5000"
    safety_model_path: Path = ROOT / "models" / "safety.joblib"

    @property
    def sqlalchemy_url(self) -> str:
        """Prisma-style URL → SQLAlchemy (psycopg 3 driver, no Prisma-only query params)."""
        url = self.database_url.split("?")[0]
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
