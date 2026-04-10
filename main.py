# main.py
import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from langchain_groq import ChatGroq

from rag.pipeline import EmbeddingManager, VectorStore, RAGRetriever, rag_query
from consentium import ConsentiumPoller

load_dotenv()

# ── RAG components ───────────────────────────────────────────────────────────
embedding_manager = EmbeddingManager()
vector_store      = VectorStore(
    collection_name="bridge_sensor_data",
    persist_directory="./data/vector_store"
)
llm = ChatGroq(
    groq_api_key=os.getenv("GROQ_API_KEY"),
    model_name="llama-3.1-8b-instant",
    temperature=0.1,
    max_tokens=1024
)
retriever = RAGRetriever(vector_store, embedding_manager)

# ── Consentium poller ────────────────────────────────────────────────────────
poller = ConsentiumPoller(
    receive_key=os.getenv("CONSENTIUM_RECEIVE_KEY", ""),
    board_key=os.getenv("CONSENTIUM_BOARD_KEY", ""),
    vector_store=vector_store,
    embedding_manager=embedding_manager,
    poll_interval=7
)


# ── Test data helpers ────────────────────────────────────────────────────────

def _test_data_already_ingested() -> bool:
    """
    Returns True if sample_document.txt has already been ingested.
    Checks by querying for documents with source=sample_document.txt.
    This check runs regardless of collection size so it is never
    accidentally skipped when sensor data already exists.
    """
    try:
        results = vector_store.collection.get(
            where={"source": "bridge_health_report.txt"},
            limit=1
        )
        return len(results["ids"]) > 0
    except Exception:
        # If the metadata filter fails for any reason, ingest to be safe
        return False


def _ingest_test_data():
    """
    Loads sample_document.txt and ingests its sentences into
    bridge_sensor_data so the chatbot can answer test questions
    (e.g. 'What is Python?') before real sensor data accumulates.
    """
    test_file = "../data/bridge_health_report.txt"
    if not os.path.exists(test_file):
        print("[Startup] bridge_health_report.txt not found — skipping test ingest.")
        return

    with open(test_file, "r", encoding="utf-8") as f:
        raw = f.read()

    # Split into sentences, keep only meaningful ones
    sentences = [
        s.strip()
        for s in raw.replace("\n", " ").split(".")
        if len(s.strip()) > 20
    ]

    if not sentences:
        print("[Startup] bridge_health_report.txt appears empty — skipping.")
        return

    embeddings = embedding_manager.generate_embeddings(sentences)
    vector_store.add_documents(
        texts=sentences,
        embeddings=embeddings,
        metadatas=[
            {"source": "bridge_health_report.txt", "type": "test_doc"}
            for _ in sentences
        ]
    )
    print(f"[Startup] Ingested {len(sentences)} test chunks from bridge_health_report.txt.")


# ── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Always check for test data — not just when collection is empty.
    # The collection may already have 372 sensor docs from previous runs
    # but still be missing the Python test content.
    if not _test_data_already_ingested():
        print("[Startup] Test data not found in collection — ingesting...")
        _ingest_test_data()
    else:
        print("[Startup] Test data already present — skipping ingest.")

    task = asyncio.create_task(poller.start())
    print("[Startup] Consentium polling task started.")
    yield
    task.cancel()
    print("[Shutdown] Polling stopped.")


app = FastAPI(title="Bridge Digital Twin API", lifespan=lifespan)


# ── Request models ────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    query: str


# ── API routes ────────────────────────────────────────────────────────────────
@app.post("/api/chat")
async def chat(request: ChatRequest):
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    result = rag_query(request.query, retriever, llm)
    return result


@app.get("/api/sensor-snapshot")
async def sensor_snapshot():
    latest = poller.get_latest_snapshot()
    if not latest:
        return JSONResponse({"status": "no_data", "data": None})
    return JSONResponse({"status": "ok", "data": latest})


@app.get("/api/sensor-history")
async def sensor_history(limit: int = 60):
    history = poller.get_history(limit=limit)
    return JSONResponse({"status": "ok", "data": history})


@app.get("/api/rag-status")
async def rag_status():
    return {"document_count": vector_store.count()}


# ── Static file serving — routes before mount ─────────────────────────────────
@app.get("/")
async def serve_index():
    return FileResponse("index.html")


@app.get("/detail")
async def serve_detail():
    return FileResponse("pages/detail.html")


# MUST be last
app.mount("/", StaticFiles(directory="."), name="static")