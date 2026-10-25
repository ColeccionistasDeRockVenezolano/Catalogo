#!/usr/bin/env python3
"""Lote de evidencia de la etapa 3 (protocolo de la etapa 2: DeepSeek analiza, Claude evalúa la prueba).

  build_evidence_batch.py pool  <out>     reúne reseñas y comentarios estratificados (sin red)
  build_evidence_batch.py annotate <out>  DeepSeek flash propone afirmaciones con cita literal
  build_evidence_batch.py items <out>     arma ítems tipados, negativos construidos y extracción

Fuentes: reseñas RYM con cruce aprobado y páginas RYM con error de identidad (reseñas de otra obra),
reseñas de usuario AOTY (Arca acotado), comentarios del blog barraezo y biografías de Last.fm que
distinguen homónimos. No usa el shoutbox (retirado por Brian el 2026-10-16).
Particiones por grupo (obra o artista): train 60 / val 15 / calib 10 / test 15, por huella del grupo.
Nada se escribe en la base. La salida va al staging del SSD.
"""
from __future__ import annotations
import glob, hashlib, json, random, re, sys, threading, urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw"
VERSION = "crv-evidence-batch-0.1.0"


def split_of(group: str) -> str:
    h = hashlib.sha256(group.encode()).digest()[0] / 256
    return "train" if h < 0.60 else "val" if h < 0.75 else "calib" if h < 0.85 else "test"


MINORITY = re.compile(r"\b(no|nunca|sin|jam[aá]s|ni|not|never|no one|isn'?t|doesn'?t|don'?t|without|lacks?|would|could|if|si fuera|ojal[aá]|quiz[aá]s|tal vez|maybe|perhaps|parece|seems|i wish|imagin|dice|dijo|says|said|ironic|ir[oó]nic|supuestamente|supposedly)\b|[\"«“]", re.I)


def pool(out: Path, targeted: bool = False, exclude: Path | None = None):
    rnd = random.Random(26 if targeted else 25)
    invalid = {json.loads(l)["archivo"].rsplit("/", 1)[-1].removesuffix(".html")
               for l in open(ROOT / "reports/reviews-rym-aoty-inventario-2026-10-24/paginas-invalidas.jsonl")}
    cruce = {}
    for l in open(ROOT / "reports/rym-integral-2026-10-21/cruce.jsonl"):
        r = json.loads(l)
        if r.get("albumId"):
            cruce[r["sourceHref"].rstrip("/") + "/"] = r
    rows, seen = [], set()
    for f in sorted(glob.glob(str(RAW / "rym-reviews-*/pages/*.json"))):
        stem = Path(f).stem
        try:
            d = json.load(open(f))
        except Exception:
            continue
        href = d.get("href", "").rstrip("/") + "/"
        bad = stem in invalid
        c = cruce.get(href)
        for r in d.get("reviews", []):
            t = (r.get("texto") or "").strip()
            if r["review_id"] in seen or len(t) < 80:
                continue
            seen.add(r["review_id"])
            artist = href.split("/")[3].replace("-", " ") if href.count("/") > 4 else ""
            if bad:
                rows.append({"source": "rym_identity_error", "group": f"rym:{href}", "object": {"kind": "album", "name": c["tituloCatalogo"] if c else href.split("/")[4].replace("-", " "), "artist": artist},
                             "text": t[:2400], "url": r.get("review_url"), "lang": None, "note": "página con error de identidad: la reseña puede ser de otra obra"})
            elif c:
                rows.append({"source": "rym", "group": f"rym:{href}", "object": {"kind": "album", "name": c["tituloCatalogo"], "artist": artist, "albumId": c["albumId"]},
                             "text": t[:2400], "url": r.get("review_url"), "lang": None})
    for l in open(RAW / "aoty-2026-10-19/user_reviews_all.jsonl"):
        r = json.loads(l)
        t = (r.get("text") or "").strip()
        if len(t) >= 120:
            rows.append({"source": "aoty", "group": f"aoty:{r['album_id']}", "object": {"kind": "album", "name": r["album"], "artist": r["artist"]},
                         "text": t[:2400], "url": r["url"], "lang": None})
    posts = {json.loads(l)["url"]: json.loads(l) for l in open(RAW / "barraezo-blogspot/posts.jsonl")}
    for l in open(RAW / "barraezo-blogspot/comments.jsonl"):
        r = json.loads(l)
        t = (r.get("content_text") or "").strip()
        p = posts.get(r["post_url"])
        if len(t) >= 60 and p:
            rows.append({"source": "barraezo", "group": f"barraezo:{r['post_url']}", "object": {"kind": "album", "name": p.get("title", ""), "artist": ""},
                         "text": t[:2400], "url": r["post_url"], "lang": "es"})
    for l in open(ROOT / "reports/lastfm-bio-2026-10-16/artists-bio.jsonl"):
        r = json.loads(l)
        bio = ((r.get("lfm") or {}).get("bio") or "").strip()
        if re.search(r"multiple artists|more th[ae]n one (band|artist)|varios artistas|several artists|There are \w+ (bands|artists)", bio, re.I):
            rows.append({"source": "lastfm_homonyms", "group": f"artist:{r['name_norm']}", "object": {"kind": "artist", "name": r["name"], "artist": r["name"], "country": "Venezuela"},
                         "text": bio[:2400], "url": (r.get("lfm") or {}).get("url"), "lang": None})
    if targeted:
        used = set()
        if exclude:
            for l in open(exclude):
                r = json.loads(l); used.add((r["source"], r["text"]))
        rows = [r for r in rows if split_of(r["group"]) != "test" and (r["source"], r["text"]) not in used
                and (MINORITY.search(r["text"]) or r["source"] in ("rym_identity_error", "lastfm_homonyms"))]
    # Estratificación: tope por obra y por artista; Arca acotada.
    rnd.shuffle(rows)
    per_group, per_artist, kept = Counter(), Counter(), []
    caps = {"rym": 6, "rym_identity_error": 2, "aoty": 4, "barraezo": 2, "lastfm_homonyms": 1}
    quota = {"rym": 520, "rym_identity_error": 70, "aoty": 260, "barraezo": 170, "lastfm_homonyms": 40}
    if targeted:
        caps = {"rym": 8, "rym_identity_error": 4, "aoty": 5, "barraezo": 3, "lastfm_homonyms": 1}
        quota = {"rym": 700, "rym_identity_error": 120, "aoty": 350, "barraezo": 120, "lastfm_homonyms": 40}
    per_source = Counter()
    for r in rows:
        a = (r["object"].get("artist") or "").lower()
        if per_group[r["group"]] >= caps[r["source"]] or per_source[r["source"]] >= quota[r["source"]]:
            continue
        if a and per_artist[a] >= (90 if a == "arca" else 60):
            continue
        per_group[r["group"]] += 1; per_artist[a] += 1; per_source[r["source"]] += 1
        r["id"] = f"{'EW' if targeted else 'EV'}-{len(kept) + 1:04d}"
        r["split"] = split_of(r["group"])
        kept.append(r)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "pool.jsonl", "w") as f:
        for r in kept:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(json.dumps({"candidates": len(rows), "kept": len(kept), "bySource": per_source, "bySplit": Counter(r["split"] for r in kept)}))


SYSTEM = """Eres analista de evidencia musical. Recibes un texto (reseña, comentario o biografía) y el OBJETO al que está asociado en el catálogo.
Extrae como máximo 4 afirmaciones sobre rasgos de la música, cada una con una cita LITERAL y exacta del texto (copiada carácter por carácter, máximo 200 caracteres).
Para cada afirmación decide, sin usar conocimiento externo:
- object_scope: same_object (describe el objeto indicado), different_object (describe otra obra, otra pista concreta, otro artista homónimo u otro nivel), unclear.
- assertion_state: affirmed (afirmación directa de quien escribe), negated (niega el rasgo), hypothetical (suposición, deseo, condición, intención imaginada), quoted (cita otra voz o la letra), possible_irony, uncertain.
- support: supports si la cita describe el rasgo en el objeto; contradicts si lo niega explícitamente.
- activity_basis: declared_use (quien escribe cuenta que la usó en una actividad real), explicit_recommendation (recomienda usarla para algo), imagined_scene (escena o deseo imaginado), represented_activity (la obra habla de una actividad), irony, absent (no hay testimonio de actividad). No deduzcas actividad desde género, emoción o ritmo.
- axis: sound | voice | production | structure | emotion | atmosphere | energy | activity | theme | genre | comparison | context.
- value: el rasgo en español, breve (3–8 palabras), sin valoración (p. ej. «guitarras distorsionadas», «ambiente oscuro», «letras sobre la dictadura», «para estudiar»). Si la cita niega un rasgo, value es el rasgo negado.
- appreciation: positive | negative | mixed | neutral.
Las puntuaciones, la popularidad y las opiniones sin rasgo («me encanta», «obra maestra») NO son afirmaciones. Si no hay rasgos, devuelve una lista vacía.
Prioriza la variedad: si hay negaciones, hipótesis, citas o usos declarados, inclúyelos.
Si el texto habla de otra obra, de una pista concreta o de otro artista, extrae también esa afirmación con object_scope different_object.
Responde SOLO JSON: {"claims":[{"quote":"...","object_scope":"...","about":"objeto descrito si es otro, o null","axis":"...","value":"...","assertion_state":"...","support":"...","activity_basis":"...","appreciation":"..."}]}"""


def annotate(out: Path):
    env = dict(l.split("=", 1) for l in (ROOT / ".env").read_text().splitlines() if l.startswith("DEEPSEEK_"))
    key = env["DEEPSEEK_API_KEY"].strip()
    model = env.get("DEEPSEEK_MODEL_FAST", env.get("DEEPSEEK_MODEL", "deepseek-flash")).strip()
    rows = [json.loads(l) for l in open(out / "pool.jsonl")]
    done = {}
    cache = out / "annotations.jsonl"
    if cache.exists():
        for l in open(cache):
            r = json.loads(l); done[r["id"]] = r
    todo = [r for r in rows if r["id"] not in done]
    usage = Counter()
    lock = threading.Lock()
    fh = open(cache, "a")

    def call(r):
        obj = r["object"]
        user = (f"OBJETO: {obj['kind']} «{obj['name']}»" + (f" de {obj['artist']}" if obj.get("artist") and obj["kind"] != "artist" else "")
                + (" (artista venezolano)" if obj.get("country") else "") + f"\nFUENTE: {r['source']}\nTEXTO:\n{r['text']}")
        body = json.dumps({"model": model, "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
                           "response_format": {"type": "json_object"}, "max_tokens": 1800, "temperature": 0.2,
                           "thinking": {"type": "disabled"}, "stream": False}).encode()
        req = urllib.request.Request("https://api.deepseek.com/chat/completions", body, {"content-type": "application/json", "authorization": f"Bearer {key}"})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    data = json.load(resp)
                claims = json.loads(data["choices"][0]["message"]["content"]).get("claims", [])
                with lock:
                    usage["calls"] += 1; usage["prompt"] += data["usage"]["prompt_tokens"]; usage["completion"] += data["usage"]["completion_tokens"]
                    fh.write(json.dumps({"id": r["id"], "analyst": f"DeepSeek ({model})", "claims": claims}, ensure_ascii=False) + "\n"); fh.flush()
                return
            except Exception as exc:  # noqa: BLE001
                if attempt == 2:
                    print("fallo", r["id"], exc, file=sys.stderr)

    with ThreadPoolExecutor(8) as ex:
        list(ex.map(call, todo))
    (out / "usage.json").write_text(json.dumps({**usage, "model": model}, indent=1))
    print(json.dumps(usage))


Q = json.loads((ROOT / "docs/unified-search/stage2/laya-evidence-questions.json").read_text())["questions"]
ENUMS = {k: set(v["criteria"]) for k, v in Q.items()}


def sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?…])\s+|\n+", text)
    return [p.strip() for p in parts if 20 <= len(p.strip()) <= 220]


def items(out: Path):
    rnd = random.Random(7)
    pool_rows = {json.loads(l)["id"]: json.loads(l) for l in open(out / "pool.jsonl")}
    ann = {json.loads(l)["id"]: json.loads(l) for l in open(out / "annotations.jsonl")}
    typed, extraction, rejected = [], [], Counter()
    by_axis = defaultdict(list)
    for rid, a in sorted(ann.items()):
        r = pool_rows[rid]
        for i, c in enumerate(a["claims"]):
            q = (c.get("quote") or "").strip()
            if not q or q not in r["text"]:
                rejected["quote_not_literal"] += 1; continue
            if c.get("object_scope") not in ENUMS["object_scope"] or c.get("assertion_state") not in ENUMS["assertion_state"] \
                    or c.get("activity_basis") not in ENUMS["activity_basis"] or c.get("support") not in ("supports", "contradicts"):
                rejected["enum"] += 1; continue
            # Coherencia mínima del protocolo: un rasgo negado contradice; otro objeto no sostiene.
            # Convenciones de la adjudicación (ver freeze_evidence_test.py): contradicts solo si la cita niega
            # el rasgo; una valoración negativa o un rasgo redactado como ausencia se sostiene.
            support = "contradicts" if c["assertion_state"] == "negated" else "supports"
            activity = c["activity_basis"] if c.get("axis") in ("activity", "context") else "absent"
            if c["object_scope"] != "same_object" or c["assertion_state"] in ("hypothetical", "quoted", "possible_irony", "uncertain"):
                support = "insufficient"
            if r["source"] == "rym_identity_error" and c["object_scope"] == "same_object":
                rejected["identity_page_same_object"] += 1; continue  # se decide en la evaluación, no por el analista
            item = {"id": f"{rid}-C{i + 1}", "review": rid, "split": r["split"], "group": r["group"], "source": r["source"], "constructed": False,
                    "state": {"object": {"kind": r["object"]["kind"], "name": r["object"]["name"], "version": None, "segment": None}, "quote": q,
                              "candidate": {"axis": c.get("axis"), "facet": None, "value": c.get("value")}, "comparison": None},
                    "gold": {"object_scope": c["object_scope"], "assertion_state": c["assertion_state"], "support": support, "activity_basis": activity},
                    "analyst": a["analyst"], "appreciation": c.get("appreciation"), "about": c.get("about")}
            typed.append(item)
            by_axis[(r["split"], c.get("axis"))].append(item)
    # Negativos construidos: misma cita con un rasgo de otra reseña del mismo eje y partición → insufficient.
    constructed = []
    for it in typed:
        if it["constructed"] or rnd.random() > 0.45:
            continue
        pool_axis = [x for x in by_axis[(it["split"], it["state"]["candidate"]["axis"])] if x["review"] != it["review"]
                     and x["state"]["candidate"]["value"] != it["state"]["candidate"]["value"]]
        if not pool_axis:
            continue
        other = rnd.choice(pool_axis)
        constructed.append({**it, "id": it["id"] + "-X", "constructed": True, "state": {**it["state"], "candidate": dict(other["state"]["candidate"])},
                            "gold": {"support": "insufficient"}, "constructedFrom": other["id"]})
    typed += constructed
    # Extracción: elegir la frase que sostiene el rasgo entre frases de la misma reseña, o «none».
    for it in typed:
        if it["gold"].get("support") == "contradicts" or it["source"] == "lastfm_homonyms":
            continue
        r = pool_rows[it["review"]]
        sents = sentences(r["text"])
        target = next((s for s in sents if it["state"]["quote"] in s or s in it["state"]["quote"]), None)
        if it["constructed"]:
            target = None
        elif target is None or it["gold"]["support"] != "supports":
            continue
        others = [s for s in sents if s != target and it["state"]["quote"] not in s]
        rnd.shuffle(others)
        opts = ([target] if target else []) + others[: (4 if target else 5)]
        if len(opts) < 2:
            continue
        rnd.shuffle(opts)
        extraction.append({"id": it["id"] + "-E", "split": it["split"], "group": it["group"], "constructed": it["constructed"],
                           "state": {"object": it["state"]["object"], "candidate": it["state"]["candidate"]},
                           "options": opts, "gold": opts.index(target) if target else "none"})
    with open(out / "typed.jsonl", "w") as f:
        for it in typed:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")
    with open(out / "extraction.jsonl", "w") as f:
        for it in extraction:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")
    stat = {"typed": len(typed), "constructed": len(constructed), "extraction": len(extraction), "rejected": rejected,
            "bySplit": Counter(i["split"] for i in typed),
            "labels": {k: Counter(i["gold"].get(k) for i in typed if k in i["gold"]) for k in ENUMS}}
    (out / "items-stats.json").write_text(json.dumps(stat, ensure_ascii=False, indent=1))
    print(json.dumps(stat, ensure_ascii=False))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "pool-targeted":
        pool(Path(sys.argv[2]), targeted=True, exclude=Path(sys.argv[3]))
    else:
        {"pool": pool, "annotate": annotate, "items": items}[cmd](Path(sys.argv[2]))
