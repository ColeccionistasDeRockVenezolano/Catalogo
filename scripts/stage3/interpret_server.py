#!/usr/bin/env python3
"""Servidor local de interpretación (etapa 3 · modo «solo si coinciden», criteria 1.10.0).

Mantiene en memoria el modelo de Laya por fragmentos (superposición 0.9.0 con su calibración) y el estudiante
(un solo paso) para que el servicio de búsqueda no los cargue en cada consulta. Solo predice: no escribe en la base,
no toca decisiones y escucha únicamente en 127.0.0.1.

  POST /laya     {"tasks":[{qid,key,family,state,question}]}  -> {"answers":[{key,choice,probabilities}], "ms":n}
  POST /student  {"text":"..."}                              -> {"canonical":{...},"confidence":x,"ms":n}
  GET  /health                                               -> versiones y huellas de los modelos

  interpret_server.py --student crv-query-student-s5 --laya crv-query-heads-0.9.0 --calibration calibration.json \
                      --thresholds student-thresholds.json [--port 3191]
"""
from __future__ import annotations
import argparse, json, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import torch  # noqa: E402
from laya_common import load_agent, predict, sha256_file, MODELS_DIR  # noqa: E402
import student as st  # noqa: E402

LOCK = threading.Lock()  # una sola GPU: las consultas se atienden de una en una
STATE: dict = {}


def student_plan(text: str) -> dict:
    row = st.raw_predict(STATE["student"], STATE["tok"], STATE["vocab"], [text], STATE["device"])[0]
    canonical, conf = st.to_plan(row, STATE["vocab"], STATE["thresholds"])
    return {"canonical": canonical, "confidence": conf}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):  # sin registro por consulta: las consultas son datos del visitante
        pass

    def _send(self, code: int, body: dict):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, STATE["health"])
        self._send(404, {"error": "not_found"})

    def do_POST(self):
        try:
            n = int(self.headers.get("content-length", "0"))
            if n <= 0 or n > 200_000:
                return self._send(413, {"error": "tamano"})
            body = json.loads(self.rfile.read(n))
            t0 = time.perf_counter()
            with LOCK:
                if self.path == "/laya":
                    tasks = body["tasks"]
                    rows = predict(STATE["agent"], tasks, STATE["calibration"], 32) if tasks else []
                    out = {"answers": [{"key": r["key"], "choice": r["choice"], "probabilities": r["probabilities"]} for r in rows]}
                elif self.path == "/student":
                    text = str(body["text"])[:300]
                    out = student_plan(text)
                    torch.cuda.synchronize() if STATE["device"].type == "cuda" else None
                else:
                    return self._send(404, {"error": "not_found"})
            out["ms"] = (time.perf_counter() - t0) * 1000
            self._send(200, out)
        except Exception as e:  # el servicio trata cualquier fallo como «sin interpretación»
            self._send(500, {"error": type(e).__name__})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--student", required=True)
    ap.add_argument("--laya", required=True)
    ap.add_argument("--calibration", required=True)
    ap.add_argument("--thresholds")
    ap.add_argument("--port", type=int, default=3191)
    a = ap.parse_args()
    STATE["calibration"] = json.loads(Path(a.calibration).read_text())
    STATE["thresholds"] = json.loads(Path(a.thresholds).read_text()) if a.thresholds else {}
    STATE["agent"], card = load_agent(a.laya)
    STATE["student"], STATE["tok"], STATE["vocab"], STATE["device"] = st.load_student(a.student)
    st.raw_predict(STATE["student"], STATE["tok"], STATE["vocab"], ["rock de los 80", "ska venezolano"], STATE["device"])  # calentamiento
    STATE["health"] = {"ok": True, "laya": a.laya, "student": a.student,
                       "studentSha256": sha256_file(MODELS_DIR / a.student / "student.pt"),
                       "layaWeightsSha256": card.get("weightsSha256"), "device": str(STATE["device"])}
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(json.dumps(STATE["health"]), flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
