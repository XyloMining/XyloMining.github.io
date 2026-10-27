"""Turn a saved Buffer list_posts result (status sent, Instagram + TikTok, includeMetrics) into data/buffer_posts.json.

Usage: python3 scripts/buffer_to_json.py LIST_RESULT.json LINKS.txt
LINKS.txt has one "postId url" per line (Buffer externalLink, from execute_query). Stories and untitled posts are skipped.
"""
import json, sys, re
raw = json.load(open(sys.argv[1]))
d = json.loads(raw[0]["text"]) if isinstance(raw, list) else raw
links = dict(l.split() for l in open(sys.argv[2]) if l.strip())
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
    rows.append({"id": f"{n['channelService'][:2]}-{n['id']}", "platform": plat, "title": title, "url": url.split("?")[0],
                 "date": n["dueAt"], "thumbnail": thumb, "views": int(m.get("views", 0) or 0), "likes": int(m.get("reactions", 0) or 0),
                 "comments": int(m.get("comments", 0) or 0), "shares": int(m.get("shares", 0) or 0), "saves": int(m.get("saves", 0) or 0),
                 "reach": int(m.get("reach", 0) or 0)})
# TikTok captions run title and body together: borrow the Instagram title for the same video, else cut at the first sentence.
ig = {r["date"][:16]: r["title"] for r in rows if r["platform"] == "Instagram"}
for r in rows:
    if r["platform"] == "TikTok":
        m = re.match(r"(.{10,110}?[?!.])(\s|$)", r["title"])
        r["title"] = ig.get(r["date"][:16]) or (m.group(1) if m else r["title"])
rows.sort(key=lambda r: r["date"], reverse=True)
json.dump({"synced": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(), "posts": rows}, open("data/buffer_posts.json", "w"), indent=2)
print(len(rows), "posts", {p: sum(r["platform"] == p for r in rows) for p in ("Instagram", "TikTok")})
