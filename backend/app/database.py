from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.config import settings
from app.models import Base

engine = create_async_engine(
    settings.database_url,
    echo=(settings.environment == "development"),
    connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {},
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def init_db() -> None:
    """Create all tables. In production, use Alembic migrations instead."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    """FastAPI dependency that yields an async DB session."""
    async with AsyncSessionLocal() as session:
        yield session
