"""Utilidades compartidas de la etapa 3 para Laya (solo predicciones y entrenamiento aislado).

- El modelo base es el checkpoint multilingüe local, fijado por su revisión del caché de Hugging Face.
- Una variante ajustada es una «superposición»: solo los pesos entrenables (cabeza de decisión,
  embeddings de tipo y puntuador, y opcionalmente las últimas capas del codificador) más su ficha.
  Se aplica sobre el base de la misma revisión; nunca reescribe el caché ni el checkpoint.
- Ninguna función escribe en la base de datos ni en decisiones editoriales.
"""
from __future__ import annotations
import hashlib, json, math, os, random, time
from pathlib import Path

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
import torch  # noqa: E402

HUB = Path.home() / ".cache/huggingface/hub/models--convaiinnovations--laya"
MODELS_DIR = Path(os.environ.get("CRV_LAYA_MODELS", Path.home() / ".local/share/crv-laya/models"))


def base_checkpoint() -> tuple[str, Path]:
    revision = (HUB / "refs/main").read_text().strip()
    if len(revision) != 40:
        raise ValueError("revisión local inválida")
    path = HUB / "snapshots" / revision / "multilingual"
    if not (path / "rl_agent_config.json").exists():
        raise FileNotFoundError("checkpoint multilingüe no está en caché")
    return revision, path


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def trainable_names(model, unfreeze_layers: int = 0) -> list[str]:
    names = [n for n, _ in model.named_parameters() if not n.startswith("encoder.")]
    if unfreeze_layers:
        layers = sorted({int(n.split(".")[2]) for n, _ in model.named_parameters() if n.startswith("encoder.layers.")})
        keep = set(layers[-unfreeze_layers:])
        names += [n for n, _ in model.named_parameters() if n.startswith("encoder.layers.") and int(n.split(".")[2]) in keep]
        names += [n for n, _ in model.named_parameters() if n.startswith("encoder.final_norm")]
    return names


def load_agent(variant: str = "base", device: str | None = None):
    """variant: 'base' o el id/ruta de una superposición en MODELS_DIR."""
    from laya import Agent
    revision, path = base_checkpoint()
    agent = Agent(str(path), device=device or ("cuda" if torch.cuda.is_available() else "cpu"))
    card = {"variant": "base", "baseRevision": revision}
    if variant != "base":
        overlay = Path(variant) if Path(variant).is_dir() else MODELS_DIR / variant
        card = json.loads((overlay / "card.json").read_text())
        if card["baseRevision"] != revision:
            raise ValueError("la superposición se entrenó sobre otra revisión del modelo base")
        weights = overlay / "overlay.safetensors"
        if sha256_file(weights) != card["weightsSha256"]:
            raise ValueError("huella de pesos distinta de la ficha")
        from safetensors.torch import load_file
        state = load_file(str(weights))
        missing = [k for k in state if k not in dict(agent.model.named_parameters()) and k not in dict(agent.model.named_buffers())]
        if missing:
            raise ValueError(f"pesos ajenos al modelo: {missing[:3]}")
        agent.model.load_state_dict(state, strict=False)
        agent.model.eval()
    agent.model.eval()
    return agent, card


def internal(agent, question: dict) -> dict:
    return agent._to_internal(question)


def encode(agent, state: str, question: dict, option_order: list[int] | None = None):
    from laya.common import build_sequence, QTYPES
    q = internal(agent, question)
    ids, markers = build_sequence(agent.tok, state, q, agent.cfg.get("max_len", 512), agent.cfg.get("head_max_len", 192),
                                  option_order=option_order)
    keys = list(q["crit"].keys())
    if len(markers) != len(keys):
        raise ValueError("opciones exceden el presupuesto de la cabeza")
    return {"ids": ids, "markers": markers, "qtype": QTYPES[q["t"]]}, keys


def logits_for(agent, items: list[dict]):
    from laya.common import collate_items
    b = collate_items([items], agent.tok.pad_token_id)
    with torch.no_grad():
        logits, _ = agent._infer(b)
    return logits.float().cpu(), b["marker_mask"].cpu()


def softmax(values: list[float], temperature: float = 1.0) -> list[float]:
    z = [v / temperature for v in values]
    m = max(z)
    e = [math.exp(v - m) for v in z]
    s = sum(e)
    return [v / s for v in e]


def predict(agent, tasks: list[dict], calibration: dict | None = None, batch: int = 24) -> list[dict]:
    """tasks: {qid, key, family, state, question}. Devuelve choice/probabilities calibradas y crudas."""
    temps = (calibration or {}).get("temperature", {})
    out = []
    for start in range(0, len(tasks), batch):
        chunk = tasks[start:start + batch]
        encoded = [encode(agent, t["state"], t["question"]) for t in chunk]
        t0 = time.perf_counter()
        logits, mask = logits_for(agent, [e[0] for e in encoded])
        ms = (time.perf_counter() - t0) * 1000 / len(chunk)
        for i, (task, (_, keys)) in enumerate(zip(chunk, encoded)):
            k = len(keys)
            raw = logits[i, :k].tolist()
            p_raw = softmax(raw)
            p = softmax(raw, float(temps.get(task["family"], 1.0)))
            best = max(range(k), key=lambda j: p[j])
            out.append({"qid": task["qid"], "key": task["key"], "family": task["family"], "choice": keys[best],
                        "probabilities": {kk: round(v, 6) for kk, v in zip(keys, p)},
                        "raw": {kk: round(v, 6) for kk, v in zip(keys, p_raw)}, "logits": [round(v, 5) for v in raw], "ms": round(ms, 3)})
    return out


def seed_all(seed: int):
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
