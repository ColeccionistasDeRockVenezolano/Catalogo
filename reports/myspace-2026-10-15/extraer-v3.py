import re, html, sys

def limpio(t):
    t = re.sub(r"<script.*?</script>", " ", t, flags=re.S)
    t = re.sub(r"<style.*?</style>", " ", t, flags=re.S)
    t = re.sub(r"<br\s*/?>", " | ", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"[ \t]+", " ", t)
    return re.sub(r"\n{3,}", "\n\n", html.unescape(t)).strip()

for f in sys.argv[1:]:
    src = open(f, encoding="utf-8", errors="replace").read()
    tit = re.search(r"<title>(.*?)</title>", src, re.S)
    print(f"\n############ {f}")
    print("TITULO:", (html.unescape(tit.group(1)).strip()[:160] if tit else "?"))
    for m in re.finditer(r'<td id="Profile([^"]{2,40})"[^>]*>(.*?)</td>', src, re.S):
        lab, val = m.group(1), limpio(m.group(2))
        val = re.split(r"a,\s*a\.man", val)[0].strip()
        if val and len(val) > 1:
            print(f"[{lab}] {val[:700]}")
    m = re.search(r'id="ProfileAbout"[^>]*>(.*?)</td>', src, re.S) or re.search(r"About\s*(?:&nbsp;)?\s*[A-Za-z0-9 ]{0,30}\s*</td>\s*<td[^>]*>(.*?)</td>", src, re.S)
    if m:
        val = limpio(m.group(1))
        print(f"[About] {val[:900]}")
