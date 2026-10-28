"""Fetch Instagram and TikTok posts + metrics from Buffer's API and merge them into postsig.json / poststt.json.

Runs in GitHub Actions (.github/workflows/refresh-buffer.yml) with the repo secret BUFFER_API_KEY. No dependencies.
Always writes data/buffer_sync.json (when it ran, whether it worked, counts, the error if any), so a failed run can be read
from the repo. The key is only read from the environment and never printed or stored.

  BUFFER_API_KEY   required
  BUFFER_API_URL   default https://api.buffer.com
  BUFFER_ORG_ID    default the XyloMining organization
Followers are not available from Buffer: they stay in data/followers.json.
"""
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request

from buffer_to_json import build_rows, merge_into_files

URL = os.environ.get("BUFFER_API_URL", "https://api.buffer.com")
KEY = os.environ.get("BUFFER_API_KEY", "")
ORG = os.environ.get("BUFFER_ORG_ID", "6ad38249b692c4ab06ad53ec")
CHANNELS = ["6ad3cd59778b240e2f3e1aff", "6ad3833b778b240e2f3a0347"]  # Instagram, TikTok
STATUS = "data/buffer_sync.json"
MAX_PAGES = 10

QUERY = """
query Posts($org: OrganizationId!, $after: String) {
  posts(
    input: {organizationId: $org, filter: {channelIds: %s, status: [sent]}, sort: [{field: dueAt, direction: desc}]}
    first: 50, after: $after
  ) {
    edges { node { id text dueAt sentAt channelId channelService externalLink metrics { type value } %s } }
    pageInfo { hasNextPage endCursor }
  }
}
""" % (json.dumps(CHANNELS), "%s")


def call(query, variables):
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "User-Agent": "xylomining-site-sync"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(5 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {e.code} from Buffer: {e.read()[:200].decode('utf-8', 'replace')}")
    raise RuntimeError("Buffer did not answer")


def fetch(with_assets):
    query = QUERY % ("assets { thumbnail }" if with_assets else "")
    edges, after = [], None
    for _ in range(MAX_PAGES):
        res = call(query, {"org": ORG, "after": after})
        if res.get("errors"):
            raise RuntimeError("GraphQL: " + "; ".join(str(e.get("message"))[:160] for e in res["errors"][:3]))
        page = res["data"]["posts"]
        edges += page["edges"]
        if not page["pageInfo"]["hasNextPage"]:
            break
        after = page["pageInfo"]["endCursor"]
    return edges


def write_status(**kw):
    os.makedirs("data", exist_ok=True)
    kw["ranAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    json.dump(kw, open(STATUS, "w"), indent=2)
    open(STATUS, "a").write("\n")


def main():
    if not KEY:
        write_status(ok=False, error="BUFFER_API_KEY is not set (add it as a repository secret)")
        sys.exit("BUFFER_API_KEY is not set")
    try:
        try:
            edges, with_assets = fetch(True), True
        except RuntimeError as e:  # the thumbnail field may not exist: retry without it (existing thumbnails are kept)
            if not str(e).startswith("GraphQL"):
                raise
            edges, with_assets = fetch(False), False
        rows = build_rows(edges)
        summary = merge_into_files(rows)
    except Exception as e:  # noqa: BLE001 - report any failure in the status file
        write_status(ok=False, error=str(e)[:400])
        sys.exit(f"Buffer sync failed: {e}")
    write_status(ok=True, fetched=len(edges), kept=len(rows), thumbnails=with_assets,
                 instagram={"posts": summary["Instagram"][0], "views": summary["Instagram"][1]},
                 tiktok={"posts": summary["TikTok"][0], "views": summary["TikTok"][1]})
    print("ok", len(edges), "posts fetched;", {k: v for k, v in summary.items()})


if __name__ == "__main__":
    main()
