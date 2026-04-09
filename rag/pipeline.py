# rag/pipeline.py
import os
import uuid
import numpy as np
import chromadb
from typing import List, Dict, Any
from sentence_transformers import SentenceTransformer

# ── SYSTEM PROMPT — aligned with notebook/doc.ipynb ──────────────────────────
# The notebook prompt is more practical: it handles bridge-specific questions
# from live context AND general engineering questions from model knowledge.
# The previous pipeline.py prompt was too restrictive ("context only") which
# caused it to refuse legitimate general questions.
BRIDGE_SYSTEM_PROMPT = """You are BridgeAI, an AI assistant exclusively dedicated to bridge structural health monitoring and engineering.

Your knowledge scope is strictly limited to:
- This bridge's live sensor data and health reports
- General politeness and professionalism in communication
- Bridge engineering, design, and structural analysis
- Vibration analysis, fatigue, and predictive maintenance
- Civil and structural engineering principles related to bridges

You are NOT permitted to answer questions outside this scope under any circumstances. Do not attempt to be helpful on out-of-scope topics. Do not provide partial answers. Do not acknowledge the out-of-scope topic at all.

Here is the current live data and report context for this specific bridge:
{context}

Question: {query}

Instructions:
1. If the question is about the current status, health scores, or recent reports, answer strictly using the provided context.
2. If the question is a general bridge or structural engineering question, use your structural engineering knowledge to answer it.
3. If combining both, clearly state what is from the actual bridge data versus what is a general engineering principle.
4. If the question is outside your defined scope — meaning it is not about bridges, structural engineering, or this bridge's health data — respond with exactly this and nothing else: "I can only assist with bridge health monitoring and structural engineering questions. This question is outside my scope."

Answer:"""


class EmbeddingManager:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        self.model_name = model_name
        self.model      = None
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
        collection_name:   str = "bridge_sensor_data",
        persist_directory: str = "../data/vector_store"
    ):
        self.collection_name   = collection_name
        self.persist_directory = persist_directory
        self.client            = None
        self.collection        = None
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
        texts:      List[str],
        embeddings: np.ndarray,
        metadatas:  List[Dict] = None
    ):
        if not texts:
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
    def __init__(
        self,
        vector_store:      VectorStore,
        embedding_manager: EmbeddingManager
    ):
        self.vector_store      = vector_store
        self.embedding_manager = embedding_manager

    def retrieve(
        self,
        query:           str,
        top_k:           int   = 5,
        score_threshold: float = 0.0
    ) -> List[Dict[str, Any]]:

        total = self.vector_store.count()
        if total == 0:
            return []

        # Cap n_results to collection size — ChromaDB errors if you ask for more
        actual_k = min(top_k, total)

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

    # only block if context is empty AND the query seems data-specific
    if not context:
        # Still send to LLM but without context — it will use its own knowledge
        prompt = BRIDGE_SYSTEM_PROMPT.format(context="No sensor data available yet.", query=query)
        try:
            response = llm.invoke([prompt])
            return {
                "answer": response.content,
                "retrieved_count": 0
            }
        except Exception as e:
            return {
                "answer": f"LLM error: {e}",
                "retrieved_count": 0
            }

    # Uses the same prompt structure as the notebook — context and query
    # are injected via .format() exactly as the notebook does it
    prompt = BRIDGE_SYSTEM_PROMPT.format(context=context, query=query)

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