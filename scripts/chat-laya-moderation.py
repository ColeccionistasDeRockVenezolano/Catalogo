#!/usr/bin/env python3
"""CRV · Trabajador persistente de Laya para moderar el chat.

Lo lanza el proceso de chat (src/chat/moderation/ai-review.ts) con
CRV_LAYA_PYTHON y habla JSON por líneas: el modelo se carga una vez y cada
mensaje cuesta ~50 ms en GPU, frente a varios segundos si se arrancara Python
por lote.

Entrada (una línea):  {"id": 1, "messages": [{"id": 10, "text": "..."}]}
Salida  (una línea):  {"id": 1, "results": [{"id": 10, "hate": 0.04, "threat": 0.02}]}
Al arrancar escribe {"ready": true}. Un error de lote responde {"id": n, "error": "..."}.
"""
import json
import sys

from laya import Router

QUESTIONS = {
    "colectivo": {
        "type": "choice",
        "instructions": (
            "Mensaje de un chat de música. ¿Insulta, desprecia o deshumaniza a un grupo de personas por su raza, "
            "nacionalidad, religión, sexo, orientación sexual, identidad de género o discapacidad?"
        ),
        "criteria": {
            "si": "Sí: ataca o desprecia a un colectivo o a alguien por pertenecer a él",
            "no": "No: habla de música, opina, bromea o usa groserías sin atacar a ningún colectivo",
        },
    },
    "amenaza": {
        "type": "choice",
        "instructions": "¿El mensaje amenaza con hacer daño físico o matar a alguien?",
        "criteria": {
            "si": "Sí: amenaza con violencia a una persona",
            "no": "No contiene amenazas de violencia",
        },
    },
}


def main() -> None:
    router = Router(default="multilingual")
    # Primera predicción en vacío: descarga y carga los pesos antes de anunciar «listo».
    router.predict("hola", QUESTIONS, model="multilingual")
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            results = []
            for message in request.get("messages", []):
                answers = router.predict(str(message["text"])[:2000], QUESTIONS, model="multilingual")["answers"]
                results.append({
                    "id": message["id"],
                    "hate": answers["colectivo"]["probabilities"]["si"],
                    "threat": answers["amenaza"]["probabilities"]["si"],
                })
            print(json.dumps({"id": request_id, "results": results}), flush=True)
        except Exception as error:  # el proceso sigue vivo para el siguiente lote
            print(json.dumps({"id": request_id, "error": str(error)[:300]}), flush=True)


if __name__ == "__main__":
    main()
