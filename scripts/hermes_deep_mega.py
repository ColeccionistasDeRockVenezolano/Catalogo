"""Descarga y valida el enlace público del libro, incluido el MAC de MEGA."""
import base64
import datetime
import hashlib
import json
import os
import pathlib
import struct
import requests
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path(os.environ['HERMES_DEEP_DATA'])/'fuentes-nuevas'
info=json.loads((ROOT/'data/raw/punkenvenezuela-2026-10-23/extras/media-externa.json').read_text())['mega']
url=info['url'];_,fid,key=url.split('!')
words=struct.unpack('>8I',base64.urlsafe_b64decode(key+'='*(-len(key)%4)))
aeskey=struct.pack('>4I',*(words[i]^words[i+4]for i in range(4)))
nonce=struct.pack('>2I',words[4],words[5])
record={'url':url,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'declaredBytes':info['bytes']}
try:
    r=requests.post('https://g.api.mega.co.nz/cs',params={'id':'crv-hermes-book'},json=[{'a':'g','g':1,'p':fid}],timeout=35)
    result=r.json()[0]
    if not isinstance(result,dict)or not result.get('g'):raise ValueError('MEGA no proporciona archivo: '+str(result)[:100])
    at=base64.urlsafe_b64decode(result['at']+'='*(-len(result['at'])%4))
    dec=Cipher(algorithms.AES(aeskey),modes.CBC(bytes(16))).decryptor();attrs=(dec.update(at)+dec.finalize()).rstrip(b'\0')
    if not attrs.startswith(b'MEGA'):raise ValueError('Metadatos cifrados inválidos')
    record['name']=json.loads(attrs[4:])['n']
    # El enlace temporal de descarga no se conserva ni se imprime.
    r=requests.get(result['g'],timeout=(15,60));r.raise_for_status();encrypted=r.content
    if len(encrypted)!=result['s']:raise ValueError('Tamaño de descarga incompleto')
    dec=Cipher(algorithms.AES(aeskey),modes.CTR(nonce+bytes(8))).decryptor();raw=dec.update(encrypted)+dec.finalize()
    global_mac=Cipher(algorithms.AES(aeskey),modes.CBC(bytes(16))).encryptor()
    start=0;step=0;mac=bytes(16)
    while start<len(raw):
        step=min(step+131072,1048576);chunk=raw[start:start+step];start+=len(chunk)
        padded=chunk+bytes((-len(chunk))%16)
        enc=Cipher(algorithms.AES(aeskey),modes.CBC(nonce+nonce)).encryptor()
        block=(enc.update(padded)+enc.finalize())[-16:]
        mac=global_mac.update(block)
    global_mac.finalize();w=struct.unpack('>4I',mac)
    if(w[0]^w[1],w[2]^w[3])!=(words[6],words[7]):raise ValueError('MAC del archivo no coincide')
    if not raw.startswith(b'%PDF-'):raise ValueError('El archivo no es PDF')
    p=OUT/'libro-mega.pdf';p.write_bytes(raw)
    record.update(result='recovered',bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),macVerified=True,path=str(p.name))
except Exception as e:
    record.update(result='blocked',reason=str(e)[:300],exception=type(e).__name__)
(OUT/'libro-mega.json').write_text(json.dumps(record,ensure_ascii=False,indent=2))
print(json.dumps(record,ensure_ascii=False))
