"""FastAPI service used by the Prompt Reducer browser extension.

Run locally with: uvicorn app:app --reload
"""
from __future__ import annotations

import os
import platform
import re
from threading import Lock
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

MODEL_ID = os.environ.get(
    "LLMLINGUA_MODEL", "microsoft/llmlingua-2-xlm-roberta-large-meetingbank"
)

_compressor = None
_load_lock = Lock()

STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by",
    "for", "from", "has", "have", "he", "her", "hers", "him", "his", "i", "if",
    "in", "into", "is", "it", "its", "me", "my", "nor", "not", "of", "on", "or",
    "our", "ours", "she", "so", "that", "the", "their", "theirs", "them", "they",
    "this", "those", "to", "was", "we", "were", "what", "when", "where", "which",
    "who", "will", "with", "would", "you", "your", "yours",
}

ABBREVIATIONS = {
    "ai": "artificial intelligence", "api": "application programming interface",
    "approx": "approximately", "asap": "as soon as possible", "e.g.": "for example",
    "etc.": "and so on", "i.e.": "that is", "info": "information", "msg": "message",
    "pls": "please", "plz": "please", "repo": "repository", "req": "requirement",
    "ui": "user interface", "url": "uniform resource locator", "vs": "versus",
}
NORMALIZATION_MAP = {
    "e-mail": "email", "e mail": "email", "log in": "login", "sign in": "login",
    "sign up": "register", "set up": "setup", "web-site": "website", "web site": "website",
}
FILLER_PHRASES = [
    "can you", "could you", "would you", "i want you to", "i would like you to",
    "please", "kind of", "sort of", "you know", "basically", "actually", "just",
    "really", "very", "literally", "in order to",
]
REDUNDANT_MODIFIERS = [
    "absolutely", "actually", "basically", "clearly", "completely", "extremely", "highly",
    "just", "literally", "really", "simply", "totally", "very",
]


class ReduceRequest(BaseModel):
    text: str = Field(max_length=100_000)
    phrase_map: Dict[str, str] = Field(default_factory=dict)
    use_ai: bool = False
    target_token: Optional[int] = Field(default=None, gt=0)


class SimilarityRequest(BaseModel):
    a: str = Field(max_length=100_000)
    b: str = Field(max_length=100_000)
    remove_stop_words: bool = False


class CompressRequest(BaseModel):
    text: str = Field(max_length=100_000)
    rate: float = Field(default=0.5, gt=0, le=1)
    target_token: Optional[int] = Field(default=None, gt=0)


def _pick_device() -> str:
    try:
        import torch
    except ImportError:
        return "cpu"
    if torch.cuda.is_available():
        return "cuda"
    if platform.system() == "Darwin" and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _load():
    """Lazily load the optional LLMLingua model only when AI mode is requested."""
    global _compressor
    if _compressor is not None:
        return _compressor
    with _load_lock:
        if _compressor is None:
            try:
                from llmlingua import PromptCompressor
            except ImportError as error:
                raise HTTPException(
                    status_code=503,
                    detail="AI reduction requires llmlingua. Install it first: pip install llmlingua",
                ) from error
            _compressor = PromptCompressor(
                model_name=MODEL_ID,
                use_llmlingua2=True,
                device_map=_pick_device(),
            )
    return _compressor


def _replace_phrases(text: str, phrase_map: Dict[str, str]) -> str:
    result = text
    for source, replacement in phrase_map.items():
        if source:
            result = re.sub(r"\b" + re.escape(source) + r"\b", replacement, result, flags=re.I)
    return result


def normalize(text: str) -> str:
    result = text.lower().strip()
    result = _replace_phrases(result, ABBREVIATIONS)
    result = _replace_phrases(result, NORMALIZATION_MAP)
    return re.sub(r"\s+", " ", result).strip()


def tokenize(text: str, remove_stop_words: bool = False) -> List[str]:
    tokens = re.findall(r"\w+", normalize(text), flags=re.ASCII)
    return [token for token in tokens if token not in STOP_WORDS] if remove_stop_words else tokens


def token_stats(text: str) -> Dict[str, Any]:
    tokens = tokenize(text)
    return {
        "count": len(tokens),
        "uniqueCount": len(set(tokens)),
        "stopWordCount": sum(token in STOP_WORDS for token in tokens),
        "tokens": tokens,
    }


def rule_reduce(text: str, phrase_map: Optional[Dict[str, str]] = None) -> str:
    result = _replace_phrases(normalize(text), phrase_map or {})
    for phrase in FILLER_PHRASES:
        result = re.sub(r"\b" + re.escape(phrase) + r"\b", " ", result, flags=re.I)
    for modifier in REDUNDANT_MODIFIERS:
        result = re.sub(r"\b" + re.escape(modifier) + r"\b(?=\s+\w+)", " ", result, flags=re.I)
    result = re.sub(r"\s+", " ", result)
    return re.sub(r"\s+([,.;!?])", r"\1", result).strip()


def jaccard(a: str, b: str, remove_stop_words: bool = False) -> Dict[str, Any]:
    left = set(tokenize(a, remove_stop_words))
    right = set(tokenize(b, remove_stop_words))
    intersection = sorted(left & right)
    union = sorted(left | right)
    ratio = 1.0 if not union else len(intersection) / len(union)
    return {
        "ratio": ratio,
        "percentage": round(ratio * 100, 2),
        "intersection": intersection,
        "union": union,
        "intersectionCount": len(intersection),
        "unionCount": len(union),
    }


def ai_compress(text: str, rate: float, target_token: Optional[int]) -> Dict[str, Any]:
    """Compress text with LLMLingua and return a browser-friendly response."""
    compressor = _load()
    options: Dict[str, Any] = {"rate": rate}
    if target_token is not None:
        options["target_token"] = target_token
    try:
        details = compressor.compress_prompt(text, **options)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"AI compression failed: {error}") from error

    compressed = details["compressed_prompt"]
    return {
        "reducedText": compressed,
        "engine": "llmlingua",
        "compression": details,
        "original": token_stats(text),
        "reduced": token_stats(compressed),
        "similarity": jaccard(text, compressed),
    }


app = FastAPI(title="Prompt Reducer API", version="1.0.0")
# A local extension has a unique chrome-extension:// origin on every install.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "model": MODEL_ID}


@app.post("/reduce")
def reduce_prompt(request: ReduceRequest) -> Dict[str, Any]:
    original = request.text.strip()
    if not original:
        return {"reducedText": "", "engine": "rules", "original": token_stats("")}

    if request.use_ai:
        return ai_compress(original, rate=0.5, target_token=request.target_token)
    else:
        reduced = rule_reduce(original, request.phrase_map)
        engine = "rules"

    return {
        "reducedText": reduced,
        "engine": engine,
        "original": token_stats(original),
        "reduced": token_stats(reduced),
        "similarity": jaccard(original, reduced),
    }


@app.post("/compress")
def compress_prompt(request: CompressRequest) -> Dict[str, Any]:
    """AI-powered prompt compression using the local LLMLingua model."""
    original = request.text.strip()
    if not original:
        return {"reducedText": "", "engine": "llmlingua", "original": token_stats("")}
    return ai_compress(original, request.rate, request.target_token)


@app.post("/similarity")
def compare_prompts(request: SimilarityRequest) -> Dict[str, Any]:
    return jaccard(request.a, request.b, request.remove_stop_words)
