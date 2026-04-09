# consentium.py
import asyncio
import requests
import math
import numpy as np
from datetime import datetime
from collections import deque
from typing import Optional

from rag.pipeline import VectorStore, EmbeddingManager

# ── CHANNEL MAP ─────────────────────────────────────────────────────────────
# Map the exact field names Consentium returns → internal axis labels.
# CHECK YOUR CONSENTIUM DASHBOARD for the real field names and update below.
# Common formats: "channel_1" / "channel_2" / "channel_3"
#             or: "x" / "y" / "z"
#             or: "ax" / "ay" / "az"
ACCEL_CHANNELS = {
    "Accel_x": "x",   # ← replace "channel_1" with your actual key
    "Accel_y": "y",   # ← replace "channel_2" with your actual key
    "Accel_z": "z",   # ← replace "channel_3" with your actual key
}

# Sensor metadata — S1 and S3 are strain gauges (hardware pending).
# S2 is the live accelerometer, driven by resultant magnitude.
SENSOR_META = {
    "S1": {"type": "strain",        "label": "L/4 span",  "unit": "με"},
    "S2": {"type": "accelerometer", "label": "Mid-span",  "unit": "g"},
    "S3": {"type": "strain",        "label": "3L/4 span", "unit": "με"},
}

RISK_WARN     = 35
RISK_CRITICAL = 70
MAX_CHROMA_DOCS = 1000
MAX_HISTORY     = 500

_session_id   = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
_poll_counter = 0


class ConsentiumPoller:

    def __init__(
        self,
        receive_key:       str,
        board_key:         str,
        vector_store:      VectorStore,
        embedding_manager: EmbeddingManager,
        poll_interval:     int = 7,
    ):
        self.receive_key       = receive_key
        self.board_key         = board_key
        self.vector_store      = vector_store
        self.embedding_manager = embedding_manager
        self.poll_interval     = poll_interval

        self._history: deque          = deque(maxlen=MAX_HISTORY)
        self._latest_snapshot: Optional[dict] = None
        self._baseline: Optional[dict]         = None

    # ── PUBLIC ───────────────────────────────────────────────────────────────
    async def start(self):
        print(f"[Consentium] Polling every {self.poll_interval}s. "
              f"Session: {_session_id}")
        while True:
            await self._poll_once()
            await asyncio.sleep(self.poll_interval)

    def get_latest_snapshot(self) -> Optional[dict]:
        return self._latest_snapshot

    def get_history(self, limit: int = 60) -> list:
        history = list(self._history)
        return history[-limit:] if limit else history

    # ── CORE POLL ─────────────────────────────────────────────────────────────
    async def _poll_once(self):
        global _poll_counter
        _poll_counter += 1

        try:
            raw = self._fetch_from_consentium()
        except Exception as e:
            print(f"[Poll #{_poll_counter}] FETCH FAILED: {e}")
            # Do not fall back to simulation — log and skip this cycle.
            # The frontend keeps showing the last valid snapshot.
            return

        snapshot = self._process_reading(raw)

        self._latest_snapshot = snapshot
        self._history.append(snapshot)

        # Ingest into RAG
        text_doc  = self._build_document(snapshot)
        embedding = self.embedding_manager.generate_embeddings([text_doc])[0]
        self.vector_store.add_documents(
            texts=[text_doc],
            embeddings=np.array([embedding]),
            metadatas=[{
                "timestamp":  snapshot["timestamp"],
                "session_id": snapshot["session_id"],
                "max_risk":   snapshot["max_risk"],
                "overall":    snapshot["overall_status"],
                "source":     "live",
            }]
        )

        self._prune_vector_store()

        print(f"[Poll #{_poll_counter}] LIVE | "
              f"x={raw['x']:+.4f} y={raw['y']:+.4f} z={raw['z']:+.4f} | "
              f"resultant={raw['resultant']:.4f}g | "
              f"S2 risk={snapshot['S2']['risk']:.1f}% | "
              f"{snapshot['overall_status']}")

    # ── CONSENTIUM FETCH ──────────────────────────────────────────────────────
    # ── CONSENTIUM FETCH (V2 STANDARDS) ──────────────────────────────────────
    def _fetch_from_consentium(self) -> dict:
        # The official endpoint for retrieving data is /getData
        url = "https://api.consentiumiot.com/getData"
        
        # Parameters passed in the URL (V2 Standard)
        # 'recents=true' ensures you only get the latest entry, saving bandwidth.
        params = {
            "receiveKey": self.receive_key,
            "boardKey": self.board_key,
            "recents": "true"
        }
        
        resp = requests.get(url, params=params, timeout=6)
        resp.raise_for_status()
        data_json = resp.json()

        # Consentium V2 returns a 'feeds' list containing the sensor values.
        # Structure: {"board": {...}, "feeds": [{"value1": x, "value2": y, ...}]}
        feeds = data_json.get("feeds", [])
        if not feeds:
            raise ValueError("No data feeds found. Check if your ESP-32 is powered on and sending data.")
        
        latest_reading = feeds[0]

        # In V2, keys are typically returned as value1, value2, value3, etc.
        # You need to map Accel_x, y, z to their positions (e.g., value1, 2, 3)
        # Based on your setup, we'll try to get them by position:
        try:
            # If your ESP-32 sends them as fields 1, 2, and 3:
            x = float(latest_reading.get("value1", 0))
            y = float(latest_reading.get("value2", 0))
            z = float(latest_reading.get("value3", 0))
        except (TypeError, ValueError):
            # Fallback: Check if the keys are exactly 'Accel_x', etc.
            x = float(latest_reading.get("Accel_x", 0))
            y = float(latest_reading.get("Accel_y", 0))
            z = float(latest_reading.get("Accel_z", 0))

        resultant = math.sqrt(x**2 + y**2 + z**2)

        return {"x": x, "y": y, "z": z, "resultant": resultant}
    
    # ── SIGNAL PROCESSING ────────────────────────────────────────────────────
    def _process_reading(self, raw: dict) -> dict:
        """
        Converts raw accelerometer axes into a full snapshot dict.
        S1 and S3 (strain gauges, hardware pending) are set to zero
        until their sensors are connected.
        """
        resultant = raw["resultant"]

        # Set baseline on first reading
        if self._baseline is None:
            self._baseline = resultant
            print(f"[Consentium] Baseline set: {self._baseline:.5f}g")

        # Risk: how much above the baseline, normalised 0-100.
        # Baseline × 2 = 50% risk. Baseline × 3 = 100% risk.
        deviation = max(0.0, resultant - self._baseline)
        s2_risk   = min(100.0, (deviation / (self._baseline * 2)) * 100)

        if s2_risk > RISK_CRITICAL:   s2_status = "Critical"
        elif s2_risk > RISK_WARN:     s2_status = "Warning"
        else:                         s2_status = "Normal"

        # S1 and S3 are zeroed until strain gauges are wired up.
        # When they are ready, add their channels to ACCEL_CHANNELS
        # (or a separate STRAIN_CHANNELS dict) and populate here.
        sensors = {
            "S1": {
                "value":  0.0,
                "risk":   0.0,
                "status": "Normal",
                "type":   "strain",
                "label":  "L/4 span",
                "unit":   "με",
            },
            "S2": {
                "value":  round(resultant, 5),
                "risk":   round(s2_risk, 1),
                "status": s2_status,
                "type":   "accelerometer",
                "label":  "Mid-span",
                "unit":   "g",
                # Raw axes stored for detail page and future FFT use
                "ax":     round(raw["x"], 5),
                "ay":     round(raw["y"], 5),
                "az":     round(raw["z"], 5),
            },
            "S3": {
                "value":  0.0,
                "risk":   0.0,
                "status": "Normal",
                "type":   "strain",
                "label":  "3L/4 span",
                "unit":   "με",
            },
        }

        max_risk = max(s["risk"] for s in sensors.values())

        return {
            "timestamp":      datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "session_id":     _session_id,
            "poll":           _poll_counter,
            "source":         "live",
            "S1":             sensors["S1"],
            "S2":             sensors["S2"],
            "S3":             sensors["S3"],
            "max_risk":       round(max_risk, 1),
            "overall_status": self._overall_label(max_risk),
        }

    def _overall_label(self, max_risk: float) -> str:
        if max_risk > RISK_CRITICAL: return "CRITICAL"
        if max_risk > RISK_WARN:     return "WARNING"
        if max_risk > 15:            return "WATCH"
        return "HEALTHY"

    # ── DOCUMENT BUILDER ──────────────────────────────────────────────────────
    def _build_document(self, snapshot: dict) -> str:
        s2 = snapshot["S2"]
        return (
            f"[{snapshot['timestamp']}] Session: {snapshot['session_id']} | "
            f"Poll #{snapshot['poll']} | Source: live\n"
            f"S1 (Strain, L/4 span):   {snapshot['S1']['value']:.5f} με | "
            f"Risk: {snapshot['S1']['risk']:.1f}% | Status: {snapshot['S1']['status']}\n"
            f"S2 (Accelerometer, Mid): {s2['value']:.5f} g | "
            f"Axes: x={s2['ax']:.4f} y={s2['ay']:.4f} z={s2['az']:.4f} | "
            f"Risk: {s2['risk']:.1f}% | Status: {s2['status']}\n"
            f"S3 (Strain, 3L/4 span):  {snapshot['S3']['value']:.5f} με | "
            f"Risk: {snapshot['S3']['risk']:.1f}% | Status: {snapshot['S3']['status']}\n"
            f"Max risk: {snapshot['max_risk']:.1f}% | "
            f"Overall: {snapshot['overall_status']}"
        )

    # ── CHROMA PRUNING ────────────────────────────────────────────────────────
    def _prune_vector_store(self):
        count = self.vector_store.count()
        if count > MAX_CHROMA_DOCS:
            to_delete = count - MAX_CHROMA_DOCS
            oldest    = self.vector_store.collection.get(limit=to_delete)
            if oldest["ids"]:
                self.vector_store.collection.delete(ids=oldest["ids"])