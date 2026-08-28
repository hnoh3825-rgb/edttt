from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.config import settings
from app.api.routes import router

app = FastAPI(
    title="Reels Clipper API",
    description="Turns long-form video into AI-selected, auto-captioned vertical clips.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve rendered clips/thumbnails directly for the frontend <video>/<img> tags.
static_dir = Path(settings.local_storage_path)
static_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

app.include_router(router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
