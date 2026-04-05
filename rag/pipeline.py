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
BRIDGE_SYSTEM_PROMPT = """You are a BridgeAI monitoring a bridge digital twin.

Here is the current live data and report context for this specific bridge:
{context}

Question: {query}

Instructions:
1. If the question is about the current status, health scores, or recent 
   reports, answer strictly using the provided context.
2. If the question is a general engineering or just a general question 
   regarding bridges (e.g., bridge design, hypotheticals, or physics, etc.), 
   use your broad structural engineering knowledge to answer it.
3. If you are combining both, clearly state what is happening on the actual 
   bridge vs. what is a general engineering principle.
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
        persist_directory: str = "./data/vector_store"
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

    if not context:
        return {
            "answer": (
                "No data in the knowledge base yet. "
                "The system is still ingesting sensor readings — "
                "please try again in a few seconds."
            ),
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