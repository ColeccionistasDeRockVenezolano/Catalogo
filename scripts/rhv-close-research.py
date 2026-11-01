#!/usr/bin/env python3
"""Bounded, resumable source discovery for the RHV review campaign. No DB writes.

All captures go to the supplied SSD staging directory. Search results are
discovery evidence only; a name in a snippet never confirms an identity.
"""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
import re
import threading
import time
import unicodedata
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests
from bs4 import BeautifulSoup


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def fold(value):
    return re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()).strip()


def clean_name(value):
    value = re.split(r"\b(?:son|fueron|eran|unen|ingresan|incorporan|incluyen|incluye|fundadores)\s+", value, flags=re.I)[-1]
    value = re.sub(r"^.*?\b(?:formad[oa]s?|conformad[oa]s?|integrad[oa]s?|liderad[oa]s?|fundad[oa]s?|compañía|destacando|destacan|destaca|encontramos)\s+(?:por|con|de|a)\s+", "", value, flags=re.I)
    return value.strip(" .,:;")


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--phase", choices=["plan", "search", "fetch"], default="plan")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--extra-plan", type=Path)
    args = parser.parse_args()
    root = args.directory.resolve()
    if not root.is_relative_to((Path.home() / "crv-staging").resolve()):
        raise SystemExit("Capturas solo en staging SSD")
    root.mkdir(parents=True, exist_ok=True)
    reviews = json.loads((root / "cases-context.json").read_text())
    existing = {x["reviewId"] for x in json.loads((root / "membership-existing-preview.json").read_text())}
    jobs = {}

    def job(query, review_id, kind, terms):
        identifier = digest(query)
        row = jobs.setdefault(identifier, {"key": identifier, "query": query, "reviewIds": [], "kind": kind, "terms": terms})
        if review_id not in row["reviewIds"]:
            row["reviewIds"].append(review_id)

    for review in reviews:
        if review["id"] in existing:
            continue
        data = review["payload"]
        reason = data.get("reason", "primary")
        artist = data.get("artist", "")
        if reason.startswith("membership"):
            name = clean_name(data.get("name", ""))
            job(f'"{artist}" Venezuela integrantes', review["id"], "artist", [artist])
            job(f'"{artist}" "{name}"', review["id"], "person", [artist, name])
        elif reason == "primary":
            title = data["title"]
            job(f'"{artist}" "{title}" Venezuela', review["id"], "artist", [artist, title])
            job(f'"{artist}" banda Caracas integrantes', review["id"], "artist", [artist])
        else:
            title = data.get("title", "")
            entries = data.get("sourceEntries", [])
            year = next((e.get("years_raw", "") for e in entries), "")
            job(f'"{title}" {year} disco compilado', review["id"], "release", [title])
            job(f'"{title}" "{artist}"', review["id"], "participation", [title, artist])
            if reason == "performer_identity":
                performer = data.get("candidates", "")
                job(f'"{artist}" "{performer}"', review["id"], "artist", [artist, str(performer)])
    if args.extra_plan:
        for item in json.loads(args.extra_plan.read_text()):
            for review_id in item["reviewIds"]:
                job(item["query"], review_id, item["kind"], item["terms"])
    (root / "search-plan.json").write_text(json.dumps(list(jobs.values()), ensure_ascii=False, indent=2))
    print(json.dumps({"phase": args.phase, "queries": len(jobs), "coveredReviews": len({i for j in jobs.values() for i in j["reviewIds"]})}), flush=True)
    if args.phase == "plan":
        return
    search_dir = root / "searches"
    search_dir.mkdir(exist_ok=True)
    if args.phase == "search":
        def search(row):
            target = search_dir / f'{row["key"]}.json'
            if target.exists():
                prior = json.loads(target.read_text())
                if prior.get("status") == 200:
                    return prior
            receipt = {**row, "queriedAt": now(), "engine": "local-searxng", "url": "http://127.0.0.1:8888/search"}
            try:
                response = requests.get(receipt["url"], params={"q": row["query"], "format": "json", "safesearch": 0, "categories": "general"}, timeout=35)
                receipt["status"] = response.status_code
                response.raise_for_status()
                body = response.json()
                receipt["results"] = body.get("results", [])[:10]
                receipt["unresponsiveEngines"] = body.get("unresponsive_engines", [])
            except Exception as error:
                receipt["error"] = str(error)
            target.write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
            return receipt
        completed = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
            for row in executor.map(search, jobs.values()):
                completed += 1
                if completed % 20 == 0:
                    print(json.dumps({"completed": completed, "total": len(jobs)}), flush=True)
        return
    # Fetch relevant sources, not unrelated results returned by engines ignoring quotes.
    pages = root / "pages"
    pages.mkdir(exist_ok=True)
    sources = {}
    ignored = []
    generic = {"venezuela", "banda", "grupo", "band", "disco", "compilado", "rock", "metal", "los", "las", "del", "una", "con", "por", "que", "the", "and"}
    for row in jobs.values():
        file = search_dir / f'{row["key"]}.json'
        if not file.exists():
            continue
        result = json.loads(file.read_text())
        terms = [set(fold(term).split()) - generic for term in row["terms"]]
        selected = []
        for item in result.get("results", []):
            url = item.get("url", "")
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https"):
                continue
            haystack = set(fold(" ".join([item.get("title", ""), item.get("content", ""), url])).split())
            music_context = re.search(r"\b(?:band|bands|banda|bandas|music|musica|musical|integrantes|guitar|guitarra|rock|metal|discos?|album|albums|cantante|vocal|discografia|discography)\b|bandcamp|discogs|youtube|metal-archives", " ".join(haystack))
            if not music_context:
                ignored.append({"queryKey": row["key"], "url": url, "reason": "no_music_context"})
                continue
            relevance = max((len(tokens & haystack) / len(tokens) for tokens in terms if tokens), default=0)
            if row["kind"] == "person" and len(terms) > 1 and terms[1]:
                relevance = len(terms[1] & haystack) / len(terms[1])
            if relevance < 0.6:
                ignored.append({"queryKey": row["key"], "url": url, "reason": "result_does_not_match_target"})
                continue
            selected.append(item)
        for item in selected[:2]:
            url = item["url"]
            source = sources.setdefault(url, {"url": url, "queryKeys": [], "reviewIds": [], "discoveryTitle": item.get("title", "")})
            source["queryKeys"].append(row["key"])
            source["reviewIds"] = sorted(set(source["reviewIds"]) | set(row["reviewIds"]))
    # Existing artist websites/profiles are more useful than another search result.
    artist_reviews = {}
    for r in reviews:
        if r["id"] not in existing and r["artistId"] is not None:
            artist_reviews.setdefault(r["artistId"], []).append(r["id"])
    for link in json.loads((root / "links.json").read_text()):
        if link["artist_id"] in artist_reviews and link["platform"] in ("website", "bandcamp"):
            url = link["url"]
            sources.setdefault(url, {"url": url, "queryKeys": [], "reviewIds": artist_reviews[link["artist_id"]], "discoveryTitle": f'Perfil del catálogo ({link["platform"]})'})
    (root / "fetch-plan.json").write_text(json.dumps(list(sources.values()), ensure_ascii=False, indent=2))
    (root / "ignored-results.json").write_text(json.dumps(ignored, ensure_ascii=False, indent=2))
    lock = threading.Lock()
    local = threading.local()
    config = {}
    for line in Path(".env").read_text().splitlines():
        if line.startswith("YOUTUBE_API_KEY="):
            config["youtubeKey"] = line.split("=", 1)[1].strip().strip("\"'")

    def session():
        if not hasattr(local, "session"):
            local.session = requests.Session()
            local.session.max_redirects = 5
            local.session.headers["User-Agent"] = "CRV-Documentary-Research/1.0"
        return local.session

    def fetch(source):
        identifier = digest(source["url"])
        target = pages / f"{identifier}.json"
        if target.exists():
            try:
                receipt = json.loads(target.read_text())
                receipt.update({"reviewIds": source["reviewIds"], "queryKeys": source["queryKeys"]})
                target.write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
                return receipt
            except json.JSONDecodeError:
                target.rename(target.with_suffix(".interrupted-json"))
        receipt = {**source, "queriedAt": now(), "method": "requests", "fileKey": identifier}
        try:
            parsed = urlparse(source["url"])
            video = parse_qs(parsed.query).get("v", [None])[0] if "youtube.com" in parsed.netloc else parsed.path.strip("/") if parsed.netloc == "youtu.be" else None
            if config.get("youtubeKey") and video:
                response = session().get("https://www.googleapis.com/youtube/v3/videos", params={"part": "snippet", "id": video, "key": config["youtubeKey"]}, timeout=(4, 8))
                receipt.update({"status": response.status_code, "finalUrl": source["url"], "method": "youtube-data-api-snippet"})
                body = response.json()
                (pages / f"{identifier}.youtube.json").write_text(json.dumps(body, ensure_ascii=False, indent=2))
                snippet = (body.get("items") or [{}])[0].get("snippet", {})
                text = "\n".join(str(snippet.get(k, "")) for k in ["title", "channelTitle", "description"])
                (pages / f"{identifier}.txt").write_text(text)
                receipt.update({"title": snippet.get("title", ""), "channelTitle": snippet.get("channelTitle", ""), "channelId": snippet.get("channelId", ""), "textChars": len(text), "textStatus": "extracted" if snippet else "not_available"})
                target.write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
                return receipt
            response = session().get(source["url"], timeout=(4, 8), stream=True)
            receipt.update({"status": response.status_code, "finalUrl": response.url, "contentType": response.headers.get("Content-Type", "")})
            chunks = []; size = 0
            for chunk in response.iter_content(65536):
                chunks.append(chunk); size += len(chunk)
                if size >= 2_000_000:
                    break
            content = b"".join(chunks)[:2_000_000]
            response.close()
            receipt.update({"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(), "truncated": size >= 2_000_000})
            if "pdf" in receipt["contentType"].lower() or source["url"].lower().endswith(".pdf"):
                (pages / f"{identifier}.pdf").write_bytes(content)
                receipt["textStatus"] = "pdf_requires_text_extraction"
            else:
                (pages / f"{identifier}.html").write_bytes(content)
                soup = BeautifulSoup(content, "html.parser")
                for noise in soup(["script", "style", "noscript"]):
                    noise.decompose()
                text = soup.get_text(" ", strip=True)
                (pages / f"{identifier}.txt").write_text(text)
                receipt["textChars"] = len(text)
                receipt["title"] = soup.title.get_text(" ", strip=True) if soup.title else ""
                if any(w in text[:1500].lower() for w in ["just a moment", "enable javascript and cookies", "log in to facebook", "inicia sesión en facebook", "verify you are human"]):
                    receipt["textStatus"] = "access_wall"
                else:
                    receipt["textStatus"] = "extracted"
        except Exception as error:
            receipt["error"] = str(error).replace(config.get("youtubeKey") or "[NO_KEY_CONFIGURED]", "[REDACTED]")
        with lock:
            target.write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
        return receipt
    print(json.dumps({"sources": len(sources), "ignoredIrrelevantResults": len(ignored)}), flush=True)
    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        for result in executor.map(fetch, sources.values()):
            completed += 1
            if completed % 20 == 0:
                print(json.dumps({"fetched": completed, "total": len(sources)}), flush=True)


if __name__ == "__main__":
    main()
