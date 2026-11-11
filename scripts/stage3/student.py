#!/usr/bin/env python3
"""Etapa 3 · 1.9.0: modelo de planes destilado (un solo paso sobre el codificador mmBERT de Laya).

  student.py train  --corpus labels.jsonl --gold-train a.json b.json … --dev c.json … --id crv-query-student-0.1.0
  student.py predict --model <id> --cases datasets.json --out plans.jsonl [--thresholds t.json]

Un plan = clase de consulta (estructural / aclarar / contradicción / no reconocida), conceptos exigidos
(multietiqueta), alternativas de aclaración, contexto del oyente, pendiente (sí/no) y nombres (etiquetado
por tokens: rol × clase). El estado se deriva como en la convención escrita (§5): sin conceptos ni nombres
y con pendiente → unsupported; solo nombres → entity_lookup; con conceptos → partial/query_valid según
el pendiente. Verificado sobre las 879 etiquetas de Claude de los lotes 1–3: 0 discrepancias.
La prueba reservada nunca se lee aquí. No escribe en la base de datos.
"""
from __future__ import annotations
import argparse, collections, hashlib, json, math, random, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from laya_common import MODELS_DIR, load_agent, seed_all  # noqa: E402
import torch  # noqa: E402
import torch.nn as nn  # noqa: E402
import torch.nn.functional as F  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
LEX = ROOT / "docs/unified-search/stage3/query-lexicon.json"
CLASSES = ["structural", "clarify", "contradiction", "unrecognized"]
KINDS = ["artist", "track", "none"]
ROLES = ["target", "reference"]
NTAG = 1 + len(KINDS) * len(ROLES) * 2
MAXLEN = 40


def vocabulary(extra: set[str]) -> list[str]:
    lx = json.loads(LEX.read_text())
    ids = {c["id"] for c in lx["concepts"]} | {f"genre:{g['slug']}" for g in lx["genres"]} | extra
    return sorted(ids)


def tag_index(kind: str | None, role: str, bi: int) -> int:
    k = KINDS.index(kind if kind in ("artist", "track") else "none")
    return 1 + ((k * 2 + ROLES.index(role)) * 2 + bi)


def tag_decode(i: int) -> tuple[str, str, int]:
    j = i - 1
    bi, rest = j % 2, j // 2
    return KINDS[rest // 2], ROLES[rest % 2], bi


def clean_gold(text: str, g: dict, vocab: set[str]) -> dict | None:
    try:
        return _clean_gold(text, g, vocab)
    except (TypeError, AttributeError, ValueError):
        return None


def _clean_gold(text: str, g: dict, vocab: set[str]) -> dict | None:
    """Normaliza una etiqueta (de Claude o del maestro). None si no se puede usar."""
    g = dict(g)
    for k in ("req", "exc", "pref", "alts", "any", "ent"):
        g[k] = g.get(k) or []
    if g["status"] not in ("query_valid", "partial", "entity_lookup", "unsupported", "clarify", "contradiction", "unrecognized"):
        return None
    if g["exc"] or g["pref"] or g["any"]:
        return None  # el modelo no los emite (cero casos en 879 etiquetas de Claude)
    fixed = []
    for r in g["req"]:
        if not isinstance(r, str):
            return None
        r = r if ":" in r else f"genre:{r}"
        if r not in vocab:
            return None
        fixed.append(r)
    g["req"] = sorted(set(fixed))
    g["alts"] = [a for a in g["alts"] if isinstance(a, str) and a in vocab]
    low = text.lower()
    ents = []
    for e in g["ent"]:
        lit = (e.get("literal") or "").lower().strip()
        if not lit or low.find(lit) < 0:
            return None
        ents.append({"literal": lit, "kind": e.get("kind") if e.get("kind") in ("artist", "track") else None,
                     "role": e.get("role") if e.get("role") in ROLES else "target"})
    g["ent"] = ents
    g["ctx"] = 1 if (g.get("ctx") or 0) else 0
    g["pend"] = 1 if (g.get("pending") or 0) > 0 else 0
    cls = g["status"] if g["status"] in ("clarify", "contradiction", "unrecognized") else "structural"
    g["cls"] = cls
    return g


def encode_example(tok, text: str, g: dict | None, vocab_idx: dict[str, int]):
    enc = tok(text, return_offsets_mapping=True, truncation=True, max_length=MAXLEN)
    ids, offs = enc["input_ids"], enc["offset_mapping"]
    out = {"ids": ids, "offs": offs}
    if g is None:
        return out
    tags = [0] * len(ids)
    low = text.lower()
    for e in g["ent"]:
        s = low.find(e["literal"])
        end = s + len(e["literal"])
        first = True
        for t, (a, b) in enumerate(offs):
            if b <= a:
                continue
            if text[a] == " ":
                a += 1  # el token «▁dan» incluye el espacio previo
            if a >= s and b <= end:
                tags[t] = tag_index(e["kind"], e["role"], 0 if first else 1)
                first = False
    out.update(tags=tags, cls=CLASSES.index(g["cls"]), ctx=g["ctx"], pend=g["pend"],
               req=[vocab_idx[r] for r in g["req"]], alts=[vocab_idx[a] for a in g["alts"] if a in vocab_idx])
    return out


class Student(nn.Module):
    def __init__(self, encoder, nvocab: int):
        super().__init__()
        self.encoder = encoder
        h = encoder.config.hidden_size
        self.drop = nn.Dropout(0.1)
        self.cls = nn.Linear(h, len(CLASSES))
        self.flags = nn.Linear(h, 2)  # ctx, pend
        self.req = nn.Linear(h, nvocab)
        self.alts = nn.Linear(h, nvocab)
        self.tag = nn.Linear(h, NTAG)
        for head in (self.req, self.alts):
            nn.init.constant_(head.bias, -5.0)  # empiezan casi en «ningún concepto»

    def forward(self, ids, mask):
        hs = self.encoder(input_ids=ids, attention_mask=mask).last_hidden_state
        pooled = self.drop(hs[:, 0])
        return self.cls(pooled), self.flags(pooled), self.req(pooled), self.alts(pooled), self.tag(self.drop(hs))


def collate(items, pad, nvocab, device):
    T = max(len(i["ids"]) for i in items)
    ids = torch.full((len(items), T), pad, dtype=torch.long)
    mask = torch.zeros((len(items), T), dtype=torch.long)
    tags = torch.full((len(items), T), -100, dtype=torch.long)
    for n, it in enumerate(items):
        L = len(it["ids"])
        ids[n, :L] = torch.tensor(it["ids"]); mask[n, :L] = 1
        if "tags" in it:
            tags[n, :L] = torch.tensor(it["tags"])
    batch = {"ids": ids.to(device), "mask": mask.to(device)}
    if "cls" in items[0]:
        batch["cls"] = torch.tensor([i["cls"] for i in items], device=device)
        batch["flags"] = torch.tensor([[i["ctx"], i["pend"]] for i in items], dtype=torch.float, device=device)
        for name in ("req", "alts"):
            y = torch.zeros((len(items), nvocab))
            for n, it in enumerate(items):
                for j in it[name]:
                    y[n, j] = 1
            batch[name] = y.to(device)
        batch["tags"] = tags.to(device)
    return batch


def losses(model, b, weights):
    lc, lf, lr, la, lt = model(b["ids"], b["mask"])
    w = weights
    l_cls = (F.cross_entropy(lc, b["cls"], reduction="none") * w).mean()
    l_fl = (F.binary_cross_entropy_with_logits(lf, b["flags"], reduction="none").mean(-1) * w).mean()
    l_req = (F.binary_cross_entropy_with_logits(lr, b["req"], reduction="none").sum(-1) * w).mean() * 0.5
    clar = (b["cls"] == CLASSES.index("clarify")).float()
    l_alts = (F.binary_cross_entropy_with_logits(la, b["alts"], reduction="none").sum(-1) * clar).mean() * 0.5
    l_tag = (F.cross_entropy(lt.transpose(1, 2), b["tags"], ignore_index=-100, reduction="none").sum(-1) * w).mean() * 0.3
    return l_cls + l_fl + l_req + l_alts + l_tag


def synthetic(vocab_set, n_cap, rnd):
    """Consultas exactas desde los alias del léxico congelado: el concepto o género solo, con «musica» y con un
    pendiente (procedencia o formato). El oro es determinista; enseña los nombres de las clases poco frecuentes."""
    lx = json.loads(LEX.read_text())
    ambiguous = {a["phrase"] for a in lx["ambiguous"]}
    items = []
    for g in lx["genres"]:
        cid = f"genre:{g['slug']}"
        for al in {g["name"].lower(), *g.get("aliases", [])}:
            items.append((al, cid))
    for c in lx["concepts"]:
        for al in c["aliases"]:
            if al not in ambiguous and len(al) > 3:
                items.append((al, c["id"]))
    rnd.shuffle(items)
    out = []
    for al, cid in items:
        r = rnd.random()
        if r < 0.35:
            text, pend = al, 0
        elif r < 0.7:
            text, pend = f"musica {al}" if cid.startswith("genre:") else f"musica {al}", 0
        else:
            text, pend = f"{al} {rnd.choice(['venezolano', 'en vivo', 'rapido', 'en ingles', 'de los 90', 'con piano', 'para ninos'])}", 1
        if cid.startswith("genre:") and pend == 0 and r >= 0.35 and rnd.random() < 0.3:
            text = f"canciones de {al}" if False else f"{al} para trabajar"
            out.append((text, {"status": "query_valid", "req": sorted([cid, "activity:concentration"]), "ent": [], "alts": [], "ctx": 0, "pending": 0}))
            continue
        out.append((text, {"status": "partial" if pend else "query_valid", "req": [cid], "ent": [], "alts": [], "ctx": 0, "pending": pend}))
    rnd.shuffle(out)
    return out[:n_cap]


def load_cases(paths):
    out = []
    for p in paths:
        out += json.loads(Path(p).read_text())["cases"]
    return out


def load_labels(path):
    rows = []
    for line in Path(path).read_text().splitlines():
        r = json.loads(line)
        if "error" not in r["gold"]:
            rows.append(r)
    return rows


def build_model(agent, nvocab):
    enc = agent.model.encoder
    for p in enc.parameters():
        p.requires_grad = True
    emb = enc.embeddings.tok_embeddings  # 197M parámetros de vocabulario: congelados
    for p in emb.parameters():
        p.requires_grad = False
    return Student(enc, nvocab)


def decode(text, offs, logits_tag, probs_tag):
    """Etiquetas por palabra (la del primer fragmento); palabras vecinas de la misma clase forman un nombre."""
    words = []  # (inicio, fin, etiqueta, confianza)
    for t, (a, b) in enumerate(offs):
        if b <= a:
            continue
        if text[a] == " ":
            a += 1
        cont = a > 0 and text[a - 1] != " " and words
        if cont:
            words[-1] = (words[-1][0], b, words[-1][2], words[-1][3])
        else:
            words.append((a, b, int(logits_tag[t]), float(probs_tag[t])))
    spans, cur = [], None
    for a, b, i, conf in words:
        if i == 0:
            if cur: spans.append(cur); cur = None
            continue
        kind, role, bi = tag_decode(i)
        if cur and not bi and cur["kind"] == kind and cur["role"] == role:
            cur["end"] = b; cur["conf"] = min(cur["conf"], conf)
        else:
            if cur: spans.append(cur)
            cur = {"kind": kind, "role": role, "start": a, "end": b, "conf": conf}
    if cur: spans.append(cur)
    return [{"literal": text[s["start"]:s["end"]].lower().strip(), "kind": None if s["kind"] == "none" else s["kind"], "role": s["role"], "conf": s["conf"]} for s in spans]


def derive_status(cls, req, ent, pend):
    if cls != "structural":
        return cls
    if not req and not ent:
        return "unsupported" if pend else "unrecognized"
    if not req:
        return "entity_lookup"
    return "partial" if pend else "query_valid"


@torch.no_grad()
def raw_predict(model, tok, vocab, texts, device, batch=64):
    model.eval()
    rows = []
    for s in range(0, len(texts), batch):
        chunk = texts[s:s + batch]
        items = [encode_example(tok, t, None, {}) for t in chunk]
        b = collate(items, tok.pad_token_id, len(vocab), device)
        with torch.autocast("cuda", dtype=torch.bfloat16, enabled=device.type == "cuda"):
            lc, lf, lr, la, lt = model(b["ids"], b["mask"])
        pc, pf, pr, pa = lc.float().softmax(-1).cpu(), lf.float().sigmoid().cpu(), lr.float().sigmoid().cpu(), la.float().sigmoid().cpu()
        ptag = lt.float().softmax(-1).cpu()
        for n, (t, it) in enumerate(zip(chunk, items)):
            L = len(it["ids"])
            tagmax = ptag[n, :L].max(-1)
            rows.append({"text": t, "pc": pc[n].tolist(), "ctx": float(pf[n, 0]), "pend": float(pf[n, 1]), "pr": pr[n].tolist(), "pa": pa[n].tolist(),
                         "ents": decode(t, it["offs"], tagmax.indices.tolist(), tagmax.values.tolist())})
    return rows


def to_plan(row, vocab, th):
    """Plan canónico + confianza. th: req (umbral de concepto), ctx, pend."""
    req = [vocab[j] for j, p in enumerate(row["pr"]) if p >= th.get("req", 0.5)]
    pend = 1 if row["pend"] >= th.get("pend", 0.5) else 0
    cls = CLASSES[max(range(len(CLASSES)), key=lambda i: row["pc"][i])]
    ents = row["ents"]
    status = derive_status(cls, req, ents, pend)
    alts = [vocab[j] for j in sorted(range(len(vocab)), key=lambda j: -row["pa"][j])[:3] if row["pa"][j] > 0.1] if status == "clarify" else []
    canonical = {"status": status, "req": sorted(req), "exc": [], "any": [], "pref": [], "ctx": 1 if row["ctx"] >= th.get("ctx", 0.5) else 0,
                 "ent": [{"role": e["role"], "kind": e["kind"], "literal": e["literal"]} for e in ents], "pending": pend, "alts": alts, "facets": []}
    # Confianza: lo más débil entre la clase, cada concepto decidido, el pendiente y cada nombre.
    confs = [max(row["pc"]), max(row["pend"], 1 - row["pend"])]
    confs += [max(p, 1 - p) for p in row["pr"] if p >= 0.02]
    confs += [e["conf"] for e in ents]
    return canonical, min(confs)


def cmd_train(a):
    seed_all(a.seed)
    rnd = random.Random(a.seed)
    device = torch.device("cuda")
    agent, base = load_agent("base")
    tok = agent.tok
    gold = load_cases(a.gold_train)
    dev = load_cases(a.dev)
    lx_ids = {c["id"] for c in json.loads(LEX.read_text())["concepts"]}
    extra = {r for c in gold + dev for r in c["gold"]["req"]}
    vocab = vocabulary(extra)
    vset, vidx = set(vocab), {v: i for i, v in enumerate(vocab)}
    labels = load_labels(a.corpus) if a.corpus else []
    # 1.10.0: etiquetas de Claude (profesor mejor) sustituyen a las del profesor barato en las mismas consultas.
    claude = [json.loads(l) for l in Path(a.claude_labels).read_text().splitlines()] if a.claude_labels else []
    cids = {r["id"] for r in claude}
    labels = [r for r in labels if r["id"] not in cids]
    train, dropped = [], 0
    for row in claude:
        g = clean_gold(row["text"], row["gold"], vset)
        if g is None:
            dropped += 1
            continue
        train.append((encode_example(tok, row["text"], g, vidx), a.claude_weight))
    for row in labels:
        g = clean_gold(row["text"], row["gold"], vset)
        if g is None:
            dropped += 1
            continue
        train.append((encode_example(tok, row["text"], g, vidx), 1.0))
    for c in gold:
        g = clean_gold(c["text"], c["gold"], vset)
        if g is None:
            dropped += 1
            continue
        train.append((encode_example(tok, c["text"], g, vidx), a.gold_weight))
    nsyn = 0
    if a.synthetic:
        for text, g in synthetic(vset, a.synthetic, rnd):
            cg = clean_gold(text, g, vset)
            if cg:
                train.append((encode_example(tok, text, cg, vidx), a.synthetic_weight)); nsyn += 1
        print(f"sintéticos {nsyn}", flush=True)
    devset = []
    for c in dev:
        g = clean_gold(c["text"], c["gold"], vset)
        if g:
            devset.append((encode_example(tok, c["text"], g, vidx), 1.0))
    print(f"entrenamiento {len(train)} (corpus {len(labels)}, oro {len(gold)}, descartadas {dropped}); desarrollo {len(devset)}; vocabulario {len(vocab)}", flush=True)
    model = build_model(agent, len(vocab)).to(device)
    model.encoder.to(torch.bfloat16)
    params = [p for p in model.parameters() if p.requires_grad]
    # Las cabezas en fp32; el codificador en bf16 (memoria).
    opt = torch.optim.AdamW([{"params": [p for n, p in model.named_parameters() if p.requires_grad and n.startswith("encoder.")], "lr": a.encoder_lr},
                             {"params": [p for n, p in model.named_parameters() if p.requires_grad and not n.startswith("encoder.")], "lr": a.lr}], weight_decay=0.01)
    steps = a.epochs * math.ceil(len(train) / a.batch)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=[a.encoder_lr, a.lr], total_steps=steps, pct_start=0.06)
    out = MODELS_DIR / a.id
    if (out / "card.json").exists():
        raise SystemExit(f"{out} ya existe")
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    for epoch in range(1, a.epochs + 1):
        model.train()
        rnd.shuffle(train)
        run = n = 0
        for s in range(0, len(train), a.batch):
            chunk = train[s:s + a.batch]
            b = collate([x for x, _ in chunk], tok.pad_token_id, len(vocab), device)
            w = torch.tensor([w for _, w in chunk], device=device)
            with torch.autocast("cuda", dtype=torch.bfloat16):
                loss = losses(model, b, w)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(params, 1.0)
            opt.step(); sched.step()
            run += loss.item() * len(chunk); n += len(chunk)
        print(f"época {epoch} pérdida {run / n:.4f} {time.time() - t0:.0f}s mem {torch.cuda.max_memory_allocated() / 2**30:.2f}GiB", flush=True)
    state = {k: v.detach().cpu() for k, v in model.state_dict().items() if not k.startswith("encoder.embeddings.tok_embeddings")}
    torch.save({"vocab": vocab, "state": state}, out / "student.pt")
    card = {"id": a.id, "kind": "student", "base": base, "hyper": vars(a), "trainRows": len(train), "vocab": len(vocab),
            "weightsSha256": hashlib.sha256((out / "student.pt").read_bytes()).hexdigest(), "reservedTestUsed": False,
            "trainedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    (out / "card.json").write_text(json.dumps(card, ensure_ascii=False, indent=1))
    print("guardado", out)


def load_student(model_id):
    agent, _ = load_agent("base")
    ck = torch.load(MODELS_DIR / model_id / "student.pt", map_location="cpu")
    model = build_model(agent, len(ck["vocab"]))
    model.encoder.to(torch.bfloat16)
    missing = model.load_state_dict(ck["state"], strict=False)
    assert not [k for k in missing.unexpected_keys], missing.unexpected_keys
    device = torch.device("cuda")
    return model.to(device), agent.tok, ck["vocab"], device


def cmd_predict(a):
    model, tok, vocab, device = load_student(a.model)
    th = json.loads(Path(a.thresholds).read_text()) if a.thresholds else {}
    cases = load_cases([a.cases])
    texts = [c["text"] for c in cases]
    raw_predict(model, tok, vocab, texts[:4], device)  # calentamiento
    rows = []
    for t in texts:  # una a una: latencia real de interpretación
        t0 = time.perf_counter()
        r = raw_predict(model, tok, vocab, [t], device)[0]
        torch.cuda.synchronize()
        r["ms"] = (time.perf_counter() - t0) * 1000
        rows.append(r)
    with open(a.out, "w") as fh:
        for c, r in zip(cases, rows):
            canonical, conf = to_plan(r, vocab, th)
            fh.write(json.dumps({"id": c["id"], "canonical": canonical, "confidence": conf, "ms": r["ms"], "raw": {k: r[k] for k in ("pc", "ctx", "pend")}}, ensure_ascii=False) + "\n")
    Path(a.out + ".raw.json").write_text(json.dumps(rows, ensure_ascii=False))
    print(f"{len(rows)} planes → {a.out}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("train")
    t.add_argument("--corpus"); t.add_argument("--gold-train", nargs="*", default=[]); t.add_argument("--dev", nargs="*", default=[])
    t.add_argument("--id", required=True); t.add_argument("--epochs", type=int, default=4); t.add_argument("--batch", type=int, default=32)
    t.add_argument("--lr", type=float, default=1e-3); t.add_argument("--encoder-lr", type=float, default=5e-5)
    t.add_argument("--synthetic", type=int, default=0); t.add_argument("--synthetic-weight", type=float, default=1.0); t.add_argument("--gold-weight", type=float, default=3.0); t.add_argument("--seed", type=int, default=7)
    t.add_argument("--claude-labels"); t.add_argument("--claude-weight", type=float, default=4.0)
    p = sub.add_parser("predict")
    p.add_argument("--model", required=True); p.add_argument("--cases", required=True); p.add_argument("--out", required=True); p.add_argument("--thresholds")
    a = ap.parse_args()
    (cmd_train if a.cmd == "train" else cmd_predict)(a)


if __name__ == "__main__":
    main()
