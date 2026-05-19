from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key:       str = ""
    redis_url:            str = ""                                        # blank = no Redis
    database_url:         str = "sqlite+aiosqlite:///./saarthi.db"
    environment:          str = "development"
    google_places_api_key: str = ""                                       # optional — OSM used if blank

    danger_bubble_radius_km: float = 1.0
    danger_bubble_ttl_sec:   int   = 30


settings = Settings()
