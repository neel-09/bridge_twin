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
ACCEL_CHANNELS = {
    "Accel_x": "x",
    "Accel_y": "y",
    "Accel_z": "z",
}

# Sensor metadata
SENSOR_META = {
    "S1": {"type": "strain",        "label": "L/4 span",  "unit": "mv"},
    "S2": {"type": "accelerometer", "label": "Mid-span",  "unit": "g"},
    "S3": {"type": "ultrasonic",    "label": "Deflection", "unit": "cm"},
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
        self._baseline: Optional[float]       = None
        self._s1_baseline: Optional[float]    = None 
        self._s3_baseline: Optional[float]    = None 

    async def start(self):
        print(f"[Consentium] Polling every {self.poll_interval}s. Session: {_session_id}")
        while True:
            await self._poll_once()
            await asyncio.sleep(self.poll_interval)

    def get_latest_snapshot(self) -> Optional[dict]:
        return self._latest_snapshot

    def get_history(self, limit: int = 60) -> list:
        history = list(self._history)
        return history[-limit:] if limit else history

    async def _poll_once(self):
        global _poll_counter
        _poll_counter += 1

        try:
            raw = self._fetch_from_consentium()
        except Exception as e:
            print(f"[Poll #{_poll_counter}] FETCH FAILED: {e}")
            return

        snapshot = self._process_reading(raw)
        self._latest_snapshot = snapshot
        self._history.append(snapshot)

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

        # ── TERMINAL LOGGING (Keeping raw x, y, z here) ─────────────────────
        print(f"[Poll #{_poll_counter}] LIVE | "
              f"x={raw['x']:+.4f} y={raw['y']:+.4f} z={raw['z']:+.4f} | "
              f"S1={raw['s1']:.2f}mv | S2={raw['resultant']:.4f}g | S3={raw['s3']:.2f}cm | "
              f"{snapshot['overall_status']}")

    def _fetch_from_consentium(self) -> dict:
        url = "https://api.consentiumiot.com/getData"
        params = {
            "receiveKey": self.receive_key,
            "boardKey": self.board_key,
            "recents": "true"
        }
        
        resp = requests.get(url, params=params, timeout=6)
        resp.raise_for_status()
        data_json = resp.json()

        feeds = data_json.get("feeds", [])
        if not feeds:
            raise ValueError("No data feeds found.")
        
        latest_reading = feeds[0]

        try:
            x  = float(latest_reading.get("value1", 0))
            y  = float(latest_reading.get("value2", 0))
            z  = float(latest_reading.get("value3", 0))
            s1 = float(latest_reading.get("value4", 0))
            s3 = float(latest_reading.get("value5", 0))
        except (TypeError, ValueError):
            x  = float(latest_reading.get("Accel_x", 0))
            y  = float(latest_reading.get("Accel_y", 0))
            z  = float(latest_reading.get("Accel_z", 0))
            s1 = float(latest_reading.get("Strain_1", 0))
            s3 = float(latest_reading.get("Distance", 0))

        resultant = math.sqrt(x**2 + y**2 + z**2)
        return {"x": x, "y": y, "z": z, "resultant": resultant, "s1": s1, "s3": s3}
    
    def _process_reading(self, raw: dict) -> dict:
        resultant = raw["resultant"]
        s1_val    = raw["s1"]
        s3_val    = raw["s3"]

        if self._baseline is None:
            self._baseline = resultant
            self._s1_baseline = s1_val
            self._s3_baseline = s3_val
            print(f"[Consentium] Baselines set: Accel={self._baseline:.4f}g, Strain={self._s1_baseline:.2f}mv, Dist={self._s3_baseline:.2f}cm")

        dev_s2  = max(0.0, resultant - self._baseline)
        s2_risk = min(100.0, (dev_s2 / (self._baseline * 2)) * 100)

        dev_s1  = abs(s1_val - self._s1_baseline)
        s1_risk = min(100.0, (dev_s1 / 500.0) * 100) 

        dev_s3  = abs(s3_val - self._s3_baseline)
        s3_risk = min(100.0, (dev_s3 / 5.0) * 100)

        # ── BROWSER SNAPSHOT (Raw x, y, z removed from S2) ──────────────────
        sensors = {
            "S1": {
                "value":  round(s1_val, 2),
                "risk":   round(s1_risk, 1),
                "status": "Critical" if s1_risk > RISK_CRITICAL else "Warning" if s1_risk > RISK_WARN else "Normal",
                "type":   "strain",
                "label":  "L/4 span",
                "unit":   "mv",
            },
            "S2": {
                "value":  round(resultant, 5),
                "risk":   round(s2_risk, 1),
                "status": "Critical" if s2_risk > RISK_CRITICAL else "Warning" if s2_risk > RISK_WARN else "Normal",
                "type":   "accelerometer",
                "label":  "Mid-span",
                "unit":   "g",
                # Note: ax, ay, az are no longer included here to keep the browser dashboard clean.
            },
            "S3": {
                "value":  round(s3_val, 2),
                "risk":   round(s3_risk, 1),
                "status": "Critical" if s3_risk > RISK_CRITICAL else "Warning" if s3_risk > RISK_WARN else "Normal",
                "type":   "ultrasonic",
                "label":  "Deflection",
                "unit":   "cm",
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

    def _build_document(self, snapshot: dict) -> str:
        s1, s2, s3 = snapshot["S1"], snapshot["S2"], snapshot["S3"]
        return (
            f"[{snapshot['timestamp']}] Session: {snapshot['session_id']} | Poll #{snapshot['poll']}\n"
            f"S1 (Strain): {s1['value']:.2f} mv | Risk: {s1['risk']}% | Status: {s1['status']}\n"
            f"S2 (Accel):  {s2['value']:.5f} g | Risk: {s2['risk']}% | Status: {s2['status']}\n"
            f"S3 (Dist):   {s3['value']:.2f} cm | Risk: {s3['risk']}% | Status: {s3['status']}\n"
            f"Max risk: {snapshot['max_risk']}% | Overall: {snapshot['overall_status']}"
        )

    def _prune_vector_store(self):
        count = self.vector_store.count()
        if count > MAX_CHROMA_DOCS:
            to_delete = count - MAX_CHROMA_DOCS
            oldest = self.vector_store.collection.get(limit=to_delete)
            if oldest["ids"]:
                self.vector_store.collection.delete(ids=oldest["ids"])