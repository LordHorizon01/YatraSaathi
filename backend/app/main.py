from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.routers import sessions, voice, geo, danger_ws, pois


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()   # Creates tables on first boot; no-op otherwise
    yield


app = FastAPI(
    title="Saarthi AI API",
    description="Fatigue detection & DangerBubble backend for YatraSaathi",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(voice.router)
app.include_router(geo.router)
app.include_router(danger_ws.router)
app.include_router(pois.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "saarthi-ai"}
