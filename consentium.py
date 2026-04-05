# consentium.py
# Polls Consentium IoT platform every N seconds.
# Converts raw readings into text documents and stores them in ChromaDB.
# Also maintains an in-memory history for the frontend to consume.

import asyncio
import requests
from datetime import datetime
from collections import deque
from typing import Optional
import numpy as np

from rag.pipeline import VectorStore, EmbeddingManager

# ── CONSENTIUM API ──────────────────────────────────────────────────────────
CONSENTIUM_URL = "https://api.consentium.io/board/getLatestEntry"

# Map Consentium channel names → our sensor IDs.
# Edit these keys to match what your ESP-32 actually publishes.
CHANNEL_MAP = {
    "channel_1": "S1",   # strain gauge, left quarter-span
    "channel_2": "S2",   # accelerometer, mid-span
    "channel_3": "S3",   # strain gauge, right quarter-span
}

SENSOR_META = {
    "S1": {"type": "strain",        "label": "L/4 span",  "unit": "με"},
    "S2": {"type": "accelerometer", "label": "Mid-span",  "unit": "g"},
    "S3": {"type": "strain",        "label": "3L/4 span", "unit": "με"},
}

# Risk thresholds (percentage)
RISK_WARN     = 35
RISK_CRITICAL = 70

# Rolling window: keep last 1000 snapshots in ChromaDB (~2 hours at 7s)
MAX_CHROMA_DOCS = 1000

# In-memory history for frontend (last 500 snapshots = ~58 minutes)
MAX_HISTORY = 500

# ── SESSION COUNTER ─────────────────────────────────────────────────────────
_session_id   = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
_poll_counter = 0


class ConsentiumPoller:

    def __init__(
        self,
        receive_key: str,
        board_key: str,
        vector_store: VectorStore,
        embedding_manager: EmbeddingManager,
        poll_interval: int = 7,
    ):
        self.receive_key       = receive_key
        self.board_key         = board_key
        self.vector_store      = vector_store
        self.embedding_manager = embedding_manager
        self.poll_interval     = poll_interval

        # In-memory ring buffer for API /sensor-history
        self._history: deque = deque(maxlen=MAX_HISTORY)
        self._latest_snapshot: Optional[dict] = None

        # Baseline for anomaly detection (set on first healthy reading)
        self._baseline: Optional[dict] = None

    # ── PUBLIC INTERFACE ────────────────────────────────────────────────────

    async def start(self):
        """Main polling loop. Runs forever as a background asyncio task."""
        print(f"[Consentium] Polling every {self.poll_interval}s. Session: {_session_id}")
        while True:
            await self._poll_once()
            await asyncio.sleep(self.poll_interval)

    def get_latest_snapshot(self) -> Optional[dict]:
        return self._latest_snapshot

    def get_history(self, limit: int = 60) -> list:
        history = list(self._history)
        return history[-limit:] if limit else history

    # ── CORE POLLING LOGIC ───────────────────────────────────────────────────

    async def _poll_once(self):
        global _poll_counter
        _poll_counter += 1

        # 1. Fetch from Consentium
        raw = self._fetch_from_consentium()
        if raw is None:
            # Fetch failed — use simulated data so the system
            # stays alive while hardware is not connected
            raw = self._generate_simulated_reading()
            source = "simulated"
        else:
            source = "live"

        # 2. Signal processing: compute risk % and status per sensor
        snapshot = self._process_reading(raw, source)

        # 3. Store in memory (for frontend API)
        self._latest_snapshot = snapshot
        self._history.append(snapshot)

        # 4. Convert to text document and store in ChromaDB
        text_doc = self._build_document(snapshot)
        embedding = self.embedding_manager.generate_embeddings([text_doc])[0]

        self.vector_store.add_documents(
            texts=[text_doc],
            embeddings=np.array([embedding]),
            metadatas=[{
                "timestamp":   snapshot["timestamp"],
                "session_id":  snapshot["session_id"],
                "max_risk":    snapshot["max_risk"],
                "overall":     snapshot["overall_status"],
                "source":      source,
            }]
        )

        # 5. Prune ChromaDB if it grows too large
        self._prune_vector_store()

        print(f"[Poll #{_poll_counter}] {source.upper()} | "
              f"S1={snapshot['S1']['value']:.4f} "
              f"S2={snapshot['S2']['value']:.4f} "
              f"S3={snapshot['S3']['value']:.4f} | "
              f"Status: {snapshot['overall_status']}")

    # ── CONSENTIUM HTTP CALL ─────────────────────────────────────────────────

    def _fetch_from_consentium(self) -> Optional[dict]:
        """
        Makes HTTP GET to Consentium and returns a dict
        { "S1": float, "S2": float, "S3": float }
        Returns None on any error.
        """
        if not self.receive_key or self.receive_key == "your_receive_key_here":
            return None   # Keys not configured — fall back to simulation

        try:
            resp = requests.get(
                CONSENTIUM_URL,
                headers={
                    "DevelopeR-Token": self.receive_key,
                    "BoardKey":        self.board_key,
                },
                timeout=5
            )
            resp.raise_for_status()
            data = resp.json()

            # Parse the response using CHANNEL_MAP
            # Adjust the key path if Consentium's response structure differs
            channel_data = data.get("data", data)  # handle nested or flat response
            parsed = {}
            for channel_key, sensor_id in CHANNEL_MAP.items():
                val = channel_data.get(channel_key)
                if val is not None:
                    parsed[sensor_id] = float(val)

            # Only return if we got all 3 sensors
            if len(parsed) == 3:
                return parsed
            print(f"[Consentium] Incomplete data received: {parsed}")
            return None

        except requests.exceptions.Timeout:
            print("[Consentium] Request timed out")
            return None
        except requests.exceptions.ConnectionError:
            print("[Consentium] Connection error")
            return None
        except Exception as e:
            print(f"[Consentium] Unexpected error: {e}")
            return None

    # ── SIGNAL PROCESSING ────────────────────────────────────────────────────

    def _process_reading(self, raw: dict, source: str) -> dict:
        """
        Takes { S1: float, S2: float, S3: float }
        Returns a full snapshot dict with risk, status, and metadata.
        """
        import time

        # Set baseline on first reading
        if self._baseline is None:
            self._baseline = {sid: abs(val) for sid, val in raw.items()}
            print(f"[Consentium] Baseline set: {self._baseline}")

        sensors = {}
        for sid, val in raw.items():
            meta      = SENSOR_META[sid]
            baseline  = self._baseline.get(sid, abs(val) or 0.01)

            # Risk % = how much above baseline, normalised to 0-100
            # A reading 3× baseline = 100% risk
            deviation = max(0, abs(val) - baseline)
            risk      = min(100, (deviation / (baseline * 2)) * 100)

            if risk > RISK_CRITICAL:
                status = "Critical"
            elif risk > RISK_WARN:
                status = "Warning"
            else:
                status = "Normal"

            sensors[sid] = {
                "value":  round(val, 5),
                "risk":   round(risk, 1),
                "status": status,
                "type":   meta["type"],
                "label":  meta["label"],
                "unit":   meta["unit"],
            }

        max_risk      = max(s["risk"] for s in sensors.values())
        overall       = self._overall_label(max_risk)

        return {
            "timestamp":      datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "session_id":     _session_id,
            "poll":           _poll_counter,
            "source":         source,
            "S1":             sensors["S1"],
            "S2":             sensors["S2"],
            "S3":             sensors["S3"],
            "max_risk":       round(max_risk, 1),
            "overall_status": overall,
        }

    def _overall_label(self, max_risk: float) -> str:
        if max_risk > RISK_CRITICAL: return "CRITICAL"
        if max_risk > RISK_WARN:     return "WARNING"
        if max_risk > 15:            return "WATCH"
        return "HEALTHY"

    # ── TEXT DOCUMENT BUILDER ─────────────────────────────────────────────────

    def _build_document(self, snapshot: dict) -> str:
        """
        Converts snapshot → human-readable text stored in ChromaDB.
        The LLM reads this text when answering user questions.
        """
        s1, s2, s3 = snapshot["S1"], snapshot["S2"], snapshot["S3"]
        return (
            f"[{snapshot['timestamp']}] Session: {snapshot['session_id']} | "
            f"Poll #{snapshot['poll']} | Source: {snapshot['source']}\n"
            f"S1 (Strain, L/4 span):    {s1['value']:.5f} {s1['unit']} | "
            f"Risk: {s1['risk']:.1f}% | Status: {s1['status']}\n"
            f"S2 (Accelerometer, Mid):  {s2['value']:.5f} {s2['unit']} | "
            f"Risk: {s2['risk']:.1f}% | Status: {s2['status']}\n"
            f"S3 (Strain, 3L/4 span):   {s3['value']:.5f} {s3['unit']} | "
            f"Risk: {s3['risk']:.1f}% | Status: {s3['status']}\n"
            f"Max risk: {snapshot['max_risk']:.1f}% | "
            f"Overall: {snapshot['overall_status']}"
        )

    # ── SIMULATED DATA (fallback while hardware not connected) ────────────────

    def _generate_simulated_reading(self) -> dict:
        import math
        t     = _poll_counter * 7          # simulated time in seconds
        noise = lambda: (np.random.random() - 0.5) * 0.005

        return {
            "S1": 0.020 * abs(math.sin(math.pi * 0.25)) + noise(),
            "S2": 0.050 * abs(math.sin(math.pi * 0.50)) + noise(),
            "S3": 0.020 * abs(math.sin(math.pi * 0.75)) + noise(),
        }

    # ── CHROMA PRUNING ────────────────────────────────────────────────────────

    def _prune_vector_store(self):
        count = self.vector_store.count()
        if count > MAX_CHROMA_DOCS:
            to_delete = count - MAX_CHROMA_DOCS
            oldest = self.vector_store.collection.get(limit=to_delete)
            if oldest["ids"]:
                self.vector_store.collection.delete(ids=oldest["ids"])