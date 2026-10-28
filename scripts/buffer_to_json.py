"""Merge a saved Buffer list_posts result into postsig.json (Instagram) and poststt.json (TikTok).

Usage: python3 scripts/buffer_to_json.py LIST_RESULT.json LINKS.txt
LINKS.txt has one "postId url" per line (Buffer externalLink, from execute_query).

These files are a growing data set: posts are matched by id and never removed, and the counts
(views, likes, comments, shares, saves, reach) never go down, even if Buffer later reports less.
Stories and untitled posts are skipped.
"""
import json
import re
import sys

COUNTS = ("views", "likes", "comments", "shares", "saves", "reach")
FILES = {"Instagram": "postsig.json", "TikTok": "poststt.json"}

raw = json.load(open(sys.argv[1]))
d = json.loads(raw[0]["text"]) if isinstance(raw, list) else raw
links = dict(line.split() for line in open(sys.argv[2]) if line.strip())

rows = []
for e in d["edges"]:
    n = e["node"]
    url = links.get(n["id"])
    if not url or "/stories/" in url:
        continue
    m = {x["type"]: x["value"] for x in n.get("metrics", [])}
    first = n["text"].strip().split("\n")[0].strip()
    title = re.sub(r"\s—\s", ": ", first).replace("—", "-")[:110]
    thumb = next((a.get("thumbnail") for a in n.get("assets", []) if a.get("thumbnail")), None)
    plat = {"instagram": "Instagram", "tiktok": "TikTok"}[n["channelService"]]
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
        m = re.match(r"(.{10,110}?[?!.])(\s|$)", r["title"])
        r["title"] = ig.get(r["date"][:16]) or (m.group(1) if m else r["title"])


def load(f):
    try:
        return json.load(open(f))
    except (OSError, ValueError):
        return []


for plat, f in FILES.items():
    merged = {p["id"]: p for p in load(f)}
    for r in (r for r in rows if r["platform"] == plat):
        old = merged.get(r["id"], {})
        new = {**old, **{k: v for k, v in r.items() if v is not None}}
        for k in COUNTS:
            new[k] = max(int(old.get(k) or 0), int(r.get(k) or 0))
        merged[r["id"]] = new
    out = sorted(merged.values(), key=lambda p: p["date"], reverse=True)
    with open(f, "w") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f, len(out), "posts,", sum(p.get("views", 0) for p in out), "views")
