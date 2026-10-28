"""Turn Buffer posts (Instagram + TikTok, status sent, with metrics) into postsig.json and poststt.json.

Two ways in:
  - scripts/buffer_sync.py calls build_rows() + merge_into_files() with posts fetched from Buffer's API (the automatic daily job).
  - CLI, for a saved list_posts result: python3 scripts/buffer_to_json.py LIST_RESULT.json LINKS.txt
    (LINKS.txt has one "postId url" per line, the Buffer externalLink.)

The files are a growing data set: posts are matched by id and never removed, and the counts
(views, likes, comments, shares, saves, reach) never go down, even if Buffer later reports less.
Stories and untitled posts are skipped.
"""
import json
import re
import sys

COUNTS = ("views", "likes", "comments", "shares", "saves", "reach")
FILES = {"Instagram": "postsig.json", "TikTok": "poststt.json"}
SERVICES = {"instagram": "Instagram", "tiktok": "TikTok"}


def build_rows(edges, links=None):
    """edges: [{"node": {...}}] as returned by Buffer. links: optional {postId: url} (else node["externalLink"])."""
    links = links or {}
    rows = []
    for e in edges:
        n = e["node"]
        url = links.get(n["id"]) or n.get("externalLink")
        plat = SERVICES.get(n.get("channelService"))
        if not url or not plat or "/stories/" in url:
            continue
        m = {x["type"]: x["value"] for x in (n.get("metrics") or [])}
        first = (n.get("text") or "").strip().split("\n")[0].strip()
        if not first:
            continue
        title = re.sub(r"\s—\s", ": ", first).replace("—", "-")[:110]
        thumb = next((a.get("thumbnail") for a in (n.get("assets") or []) if a.get("thumbnail")), None)
        rows.append({
            "id": f"{n['channelService'][:2]}-{n['id']}", "platform": plat, "title": title, "url": url.split("?")[0],
            "date": n["dueAt"], "thumbnail": thumb,
            "views": int(m.get("views", 0) or 0), "likes": int(m.get("reactions", 0) or 0),
            "comments": int(m.get("comments", 0) or 0), "shares": int(m.get("shares", 0) or 0),
            "saves": int(m.get("saves", 0) or 0), "reach": int(m.get("reach", 0) or 0),
        })
    # TikTok captions run title and body together: borrow the Instagram title for the same video, else cut at the first sentence.
    ig = {r["date"][:16]: r["title"] for r in rows if r["platform"] == "Instagram"}
    for r in rows:
        if r["platform"] == "TikTok":
            mt = re.match(r"(.{10,110}?[?!.])(\s|$)", r["title"])
            r["title"] = ig.get(r["date"][:16]) or (mt.group(1) if mt else r["title"])
    return rows


def _load(f):
    try:
        return json.load(open(f))
    except (OSError, ValueError):
        return []


def merge_into_files(rows, base="."):
    """Merge rows into the two files (never remove, counts never go down). Returns {platform: (posts, views)}."""
    summary = {}
    for plat, name in FILES.items():
        f = f"{base}/{name}"
        merged = {p["id"]: p for p in _load(f)}
        for r in (r for r in rows if r["platform"] == plat):
            old = merged.get(r["id"], {})
            new = {**old, **{k: v for k, v in r.items() if v is not None}}
            for k in COUNTS:
                new[k] = max(int(old.get(k) or 0), int(r.get(k) or 0))
            merged[r["id"]] = new
        out = sorted(merged.values(), key=lambda p: p["date"], reverse=True)
        text = json.dumps(out, indent=2, ensure_ascii=False) + "\n"
        try:
            same = open(f).read() == text
        except OSError:
            same = False
        if not same:
            open(f, "w").write(text)
        summary[plat] = (len(out), sum(p.get("views", 0) for p in out))
    return summary


if __name__ == "__main__":
    raw = json.load(open(sys.argv[1]))
    d = json.loads(raw[0]["text"]) if isinstance(raw, list) else raw
    links = dict(line.split() for line in open(sys.argv[2]) if line.strip())
    for plat, (n, v) in merge_into_files(build_rows(d["edges"], links)).items():
        print(plat, n, "posts,", v, "views")
