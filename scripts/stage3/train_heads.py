#!/usr/bin/env python3
"""Ajuste de Laya para la etapa 3: entrena una superposición (cabeza de decisión y, si se pide,
las últimas capas del codificador) sobre el checkpoint multilingüe base, sin tocarlo.

  train_heads.py --train tasks-train.jsonl --val tasks-val.jsonl --id crv-query-heads-0.1.0 \
      [--unfreeze 0] [--epochs 3] [--lr 2e-4] [--batch 16] [--other-keep 0.25] [--seed 7]

Las tareas llevan `gold` (clave de la opción correcta). El orden de las opciones se baraja en
cada ejemplo para que el modelo no aprenda posiciones. La validación elige la mejor época; la
prueba reservada nunca se lee aquí. Salida: MODELS_DIR/<id>/{overlay.safetensors, card.json, log.jsonl}.
"""
from __future__ import annotations
import argparse, collections, json, random, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from laya_common import MODELS_DIR, encode, load_agent, seed_all, sha256_file, trainable_names  # noqa: E402
import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402


def load(path, other_keep=1.0, rnd=None):
    rows = [json.loads(l) for l in open(path) if l.strip()]
    if other_keep < 1.0:
        rows = [r for r in rows if r["gold"] != "other" or r["family"] in ("span", "dim") or rnd.random() < other_keep]
    return rows


def encode_rows(agent, rows, shuffle: bool, rnd):
    out = []
    for r in rows:
        keys = list(r["question"]["criteria"].keys())
        order = list(range(len(keys)))
        if shuffle:
            rnd.shuffle(order)
        item, _ = encode(agent, r["state"], r["question"], option_order=order)
        # marker j corresponde a la opción order[j]
        item["target_index"] = order.index(keys.index(r["gold"]))
        out.append((r, item))
    return out


def batches(items, size, rnd=None):
    idx = list(range(len(items)))
    if rnd:
        rnd.shuffle(idx)
    for s in range(0, len(idx), size):
        yield [items[i] for i in idx[s:s + size]]


def forward(agent, chunk, train: bool):
    from laya.common import collate_items
    b = collate_items([[it for _, it in chunk]], agent.tok.pad_token_id)
    dev = agent.device
    with torch.autocast("cuda", dtype=torch.bfloat16, enabled=dev.type == "cuda" if hasattr(dev, "type") else True):
        logits, _ = agent.model(b["input_ids"].to(dev), b["attention_mask"].to(dev), b["marker_pos"].to(dev),
                                b["marker_mask"].to(dev), b["qtype"].to(dev))
    target = torch.tensor([it["target_index"] for _, it in chunk], device=logits.device)
    return logits.float(), target, b["marker_mask"].to(logits.device)


def masked_loss(logits, target, mask, smoothing=0.0, reduction="mean"):
    """Entropía cruzada solo sobre las opciones reales; el suavizado reparte masa entre ellas."""
    logp = torch.log_softmax(logits.masked_fill(~mask, float("-inf")), -1).masked_fill(~mask, 0.0)
    nll = -logp.gather(1, target[:, None]).squeeze(1)
    if smoothing:
        nll = (1 - smoothing) * nll - smoothing * logp.sum(-1) / mask.sum(-1)
    return nll.mean() if reduction == "mean" else nll.sum()


def evaluate(agent, enc, size=32):
    agent.model.eval()
    per = collections.defaultdict(lambda: [0, 0])
    loss_sum = 0.0
    with torch.no_grad():
        for chunk in batches(enc, size):
            logits, target, mask = forward(agent, chunk, False)
            loss_sum += masked_loss(logits, target, mask, reduction="sum").item()
            pred = logits.argmax(-1)
            for (r, _), p, t in zip(chunk, pred.tolist(), target.tolist()):
                per[r["family"]][0] += int(p == t)
                per[r["family"]][1] += 1
    acc = {f: round(c / n, 4) for f, (c, n) in per.items()}
    total = sum(n for _, n in per.values())
    return {"loss": round(loss_sum / total, 4), "acc": round(sum(c for c, _ in per.values()) / total, 4), "byFamily": acc}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", required=True)
    ap.add_argument("--val", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--unfreeze", type=int, default=0)
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--encoder-lr", type=float, default=2e-5)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--other-keep", type=float, default=0.25)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--balance", action="store_true", help="repite ejemplos de clases minoritarias por familia (hasta ×4)")
    ap.add_argument("--limit", type=int, default=0, help="solo para pruebas de memoria/tiempo")
    args = ap.parse_args()
    out = MODELS_DIR / args.id
    if (out / "card.json").exists():
        raise SystemExit(f"{out} ya existe; las versiones no se sobrescriben")
    seed_all(args.seed)
    rnd = random.Random(args.seed)
    agent, base = load_agent("base")
    model = agent.model
    names = set(trainable_names(model, args.unfreeze))
    for n, p in model.named_parameters():
        p.requires_grad = n in names
    train_rows = load(args.train, args.other_keep, rnd)
    if args.balance:
        counts = collections.Counter((r["family"], r["gold"]) for r in train_rows)
        top = collections.Counter()
        for (fam, _), n in counts.items():
            top[fam] = max(top[fam], n)
        train_rows = [r for r in train_rows for _ in range(min(4, max(1, int((top[r["family"]] / counts[(r["family"], r["gold"])]) ** 0.5))))]
    val_rows = load(args.val)
    if args.limit:
        train_rows, val_rows = train_rows[:args.limit], val_rows[:max(64, args.limit // 4)]
    val_enc = encode_rows(agent, val_rows, False, rnd)
    head = [p for n, p in model.named_parameters() if n in names and not n.startswith("encoder.")]
    enc = [p for n, p in model.named_parameters() if n in names and n.startswith("encoder.")]
    opt = torch.optim.AdamW([{"params": head, "lr": args.lr}] + ([{"params": enc, "lr": args.encoder_lr}] if enc else []), weight_decay=0.01)
    steps = args.epochs * ((len(train_rows) + args.batch - 1) // args.batch)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=[g["lr"] for g in opt.param_groups], total_steps=steps, pct_start=0.06)
    out.mkdir(parents=True)
    log = open(out / "log.jsonl", "w")
    base_eval = evaluate(agent, val_enc)
    log.write(json.dumps({"epoch": 0, "val": base_eval}) + "\n"); log.flush()
    print("base", json.dumps(base_eval), flush=True)
    best, best_state = None, None
    t0 = time.time()
    for epoch in range(1, args.epochs + 1):
        model.train()
        if not enc:
            model.encoder.eval()  # sin dropout en el codificador congelado
        train_enc = encode_rows(agent, train_rows, True, rnd)  # nuevo barajado de opciones por época
        run_loss, seen = 0.0, 0
        for i, chunk in enumerate(batches(train_enc, args.batch, rnd)):
            logits, target, mask = forward(agent, chunk, True)
            loss = masked_loss(logits, target, mask, smoothing=0.05)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.0)
            opt.step(); sched.step()
            run_loss += loss.item() * len(chunk); seen += len(chunk)
            if i % 200 == 0:
                print(f"época {epoch} lote {i} pérdida {run_loss / seen:.4f} {time.time() - t0:.0f}s "
                      f"mem {torch.cuda.max_memory_allocated() / 2**30:.2f}GiB", flush=True)
        ev = evaluate(agent, val_enc)
        rec = {"epoch": epoch, "trainLoss": round(run_loss / seen, 4), "val": ev, "seconds": round(time.time() - t0)}
        log.write(json.dumps(rec) + "\n"); log.flush()
        print(json.dumps(rec), flush=True)
        if best is None or ev["loss"] < best["val"]["loss"]:
            best = rec
            best_state = {n: p.detach().to("cpu", torch.float32).clone() for n, p in model.named_parameters() if n in names}
    from safetensors.torch import save_file
    save_file(best_state, str(out / "overlay.safetensors"))
    card = {
        "id": args.id, "kind": "laya-overlay", "task": "query_interpretation", "baseRevision": base["baseRevision"],
        "baseCheckpoint": "convaiinnovations/laya multilingual", "trainable": sorted(names) if len(names) < 80 else f"{len(names)} tensores",
        "unfreezeLayers": args.unfreeze, "hyper": {k: v for k, v in vars(args).items() if k not in ("train", "val", "id")},
        "train": {"path": args.train, "sha256": sha256_file(Path(args.train)), "rows": len(train_rows)},
        "val": {"path": args.val, "sha256": sha256_file(Path(args.val)), "rows": len(val_rows)},
        "baseVal": base_eval, "bestEpoch": best["epoch"], "bestVal": best["val"],
        "weightsSha256": sha256_file(out / "overlay.safetensors"), "trainedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "reservedTestUsed": False, "public": False,
    }
    (out / "card.json").write_text(json.dumps(card, ensure_ascii=False, indent=1))
    print(json.dumps({"id": args.id, "bestEpoch": best["epoch"], "bestVal": best["val"]}))


if __name__ == "__main__":
    main()
