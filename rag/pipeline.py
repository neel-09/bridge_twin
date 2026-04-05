# rag/pipeline.py
import os
import uuid
import numpy as np
import chromadb
from typing import List, Dict, Any
from sentence_transformers import SentenceTransformer

BRIDGE_SYSTEM_PROMPT = """You are BridgeAI, an intelligent structural health 
monitoring assistant for a bridge digital twin system. You have access to 
real-time and historical sensor data from three sensors:
- S1: Strain gauge at the left quarter-span
- S2: Accelerometer at mid-span
- S3: Strain gauge at the right quarter-span

When asked about bridge health, always structure your response as:
1. Current Status (Healthy / Watch / Warning / Critical)
2. Key observations from sensor data
3. Specific recommendation if any anomaly detected

When asked general questions, answer using the provided context.
Use only the context provided. Do not invent information."""


class EmbeddingManager:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        self.model_name = model_name
        self.model = None
        self._load_model()

    def _load_model(self):
        try:
            print(f"Loading embedding model '{self.model_name}'...")
            self.model = SentenceTransformer(self.model_name)
            print(f"Model loaded. Dimensions: "
                  f"{self.model.get_sentence_embedding_dimension()}")
        except Exception as e:
            print(f"Error loading model: {e}")

    def generate_embeddings(self, texts: List[str]) -> np.ndarray:
        if not self.model:
            raise ValueError("Embedding model not loaded.")
        return self.model.encode(texts, show_progress_bar=False)


class VectorStore:
    def __init__(
        self,
        collection_name: str = "bridge_sensor_data",
        persist_directory: str = "./data/vector_store"
    ):
        self.collection_name  = collection_name
        self.persist_directory = persist_directory
        self.client           = None
        self.collection       = None
        self._initialize_store()

    def _initialize_store(self):
        os.makedirs(self.persist_directory, exist_ok=True)
        self.client = chromadb.PersistentClient(path=self.persist_directory)
        self.collection = self.client.get_or_create_collection(
            name=self.collection_name,
            metadata={"description": "Bridge sensor health snapshots"}
        )
        print(f"VectorStore ready. Collection: {self.collection_name} "
              f"({self.collection.count()} docs)")

    def add_documents(
        self,
        texts: List[str],
        embeddings: np.ndarray,
        metadatas: List[Dict] = None
    ):
        if len(texts) == 0:
            return
        ids  = [f"doc_{uuid.uuid4().hex[:8]}_{i}" for i in range(len(texts))]
        meta = metadatas or [{} for _ in texts]
        try:
            self.collection.add(
                ids=ids,
                embeddings=[e.tolist() for e in embeddings],
                metadatas=meta,
                documents=texts
            )
        except Exception as e:
            print(f"[VectorStore] add_documents error: {e}")

    def count(self) -> int:
        return self.collection.count()


class RAGRetriever:
    def __init__(self, vector_store: VectorStore, embedding_manager: EmbeddingManager):
        self.vector_store      = vector_store
        self.embedding_manager = embedding_manager

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        score_threshold: float = 0.0
    ) -> List[Dict[str, Any]]:

        # ── CRITICAL FIX ─────────────────────────────────────────────────────
        # ChromaDB raises an error if n_results > collection size.
        # Always cap n_results to what is actually available.
        total = self.vector_store.count()
        if total == 0:
            return []
        actual_k = min(top_k, total)
        # ─────────────────────────────────────────────────────────────────────

        try:
            query_embedding = self.embedding_manager.generate_embeddings([query])[0]
            results = self.vector_store.collection.query(
                query_embeddings=[query_embedding.tolist()],
                n_results=actual_k
            )
        except Exception as e:
            print(f"[RAGRetriever] retrieve error: {e}")
            return []

        retrieved = []
        if results["documents"] and results["documents"][0]:
            for doc_id, doc, meta, dist in zip(
                results["ids"][0],
                results["documents"][0],
                results["metadatas"][0],
                results["distances"][0]
            ):
                score = 1 - dist
                if score >= score_threshold:
                    retrieved.append({
                        "id":               doc_id,
                        "content":          doc,
                        "metadata":         meta,
                        "similarity_score": score
                    })
        return retrieved


def rag_query(query: str, retriever: RAGRetriever, llm, top_k: int = 5) -> Dict:
    results = retriever.retrieve(query, top_k=top_k, score_threshold=0.0)
    context = "\n\n".join([r["content"] for r in results]) if results else ""

    if not context:
        return {
            "answer": (
                "No data in the knowledge base yet. "
                "The system is still ingesting sensor readings — "
                "please try again in a few seconds."
            ),
            "retrieved_count": 0
        }

    prompt = f"""{BRIDGE_SYSTEM_PROMPT}

Context:
{context}

Question: {query}
Answer:"""

    try:
        response = llm.invoke([prompt])
        return {
            "answer":          response.content,
            "retrieved_count": len(results)
        }
    except Exception as e:
        return {
            "answer":          f"LLM error: {e}",
            "retrieved_count": len(results)
        }