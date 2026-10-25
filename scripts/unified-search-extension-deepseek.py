"""Primera lectura del tramo de ampliación con DeepSeek flash (analista distinto del evaluador)."""
import json, sys, urllib.request
from pathlib import Path
env = dict(l.split('=', 1) for l in Path('/home/brian/apps/Coleccionistas De Rock Venezolano/.env').read_text().splitlines() if l.startswith('DEEPSEEK_'))
KEY, MODEL = env['DEEPSEEK_API_KEY'].strip(), env.get('DEEPSEEK_MODEL', 'deepseek-flash').strip()
ASPECTS = "atmosphere, timbre, timbre.fuzz-lead-guitar, production.texture, production.sources, production.fidelity-aesthetic, production.programmed-drums, instrumentation.presence, instrumentation.prominence, instrumentation.synthesizers, instrumentation.acoustic-element, rhythm.danceability, rhythm.variation, structure.repetition, structure.variety, structure.development, structure.directness, style.mixture, guitars.style-reference, vocals.prominence, vocals.lyrics, voice.consistency, listening.perceived-length, listening.condition, reception.generic-praise, reception.lyrics-vs-music, reception.artist-style, reception.critical-discourse, reception.closure, context.genre-novelty, affinity.aspect, performance.live-sound"
SYSTEM = f"""Eres analista musical del Archivo de Coleccionistas de Rock Venezolano. Anotas UNA cita de una reseña o fanzine con el método review-analysis-0.2.0.
Reglas: lee solo lo que la cita dice; el contexto sirve para entender a qué se refiere, no para añadir rasgos. No generalices más allá de la cita. Una comparación con otra banda es type=comparison y aspect=affinity.aspect con value=nombre de la referencia (si hay varias, nómbralas separadas por coma). Una intención atribuida por un tercero es attributed_intent. Lo que la banda dice de sí misma en entrevista es context o fact con state=affirmed y se aclara en la interpretación. Una pregunta irónica es possible_irony. Un concierto en vivo se aclara en listeningCondition.
Responde SOLO un objeto JSON con estas claves:
type: sound|lyrics|taste|comparison|experience|context|fact|attributed_intent
aspect: punto-separado en minúsculas; reutiliza uno de [{ASPECTS}] si encaja, o crea uno con el mismo estilo
value: valor breve en kebab-case
state: affirmed|negated|hypothetical|conditional|quoted|possible_irony|corrected|withdrawn|uncertain
appreciation: liked|disliked|mixed|descriptive
coverage: complete|partial|unknown (si el rasgo vale para todo el objeto, solo una parte, o no se sabe)
listeningCondition: texto breve o null
interpretation: 1-2 frases en español, qué afirma la cita y sobre qué
alternative: 1 frase en español con otra lectura posible o el límite de la cita
query: consulta de búsqueda en español que esta anotación podría responder
objectNote: null, o una frase si la cita habla de algo distinto del objeto indicado (otro disco, un concierto, varios discos)"""

def call(item):
    user = (f"Objeto indicado: {item['object']['kind']} «{item['object']['name']}» de {item['artist']}\n"
            f"Fuente: {item['work']} ({'reseña de usuario en AOTY' if item['resourceId']=='R45' else 'fanzine punk venezolano, texto por OCR'})\n"
            f"Contexto: …{item['context']}…\n\nCita a anotar: «{item['quote']}»")
    body = json.dumps({'model': MODEL, 'messages': [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': user}],
                       'response_format': {'type': 'json_object'}, 'max_tokens': 1200, 'thinking': {'type': 'disabled'}, 'stream': False}).encode()
    req = urllib.request.Request('https://api.deepseek.com/chat/completions', body, {'content-type': 'application/json', 'authorization': f'Bearer {KEY}'})
    with urllib.request.urlopen(req, timeout=90) as r: env_ = json.load(r)
    return json.loads(env_['choices'][0]['message']['content']), env_.get('model', MODEL)

items = json.load(open(sys.argv[1])); out = []
for it in items:
    reading, model = call(it)
    out.append({'id': it['id'], 'model': model, 'reading': reading}); print(it['id'], json.dumps(reading, ensure_ascii=False)[:160], flush=True)
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
