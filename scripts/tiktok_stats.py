"""Fetch public stats for a TikTok account with davidteather/TikTok-Api (unofficial, read-only).

Run it on a machine that can reach tiktok.com (the Claude sandbox cannot):
    pip install TikTokApi && python -m playwright install chromium
    export ms_token="<msToken cookie from tiktok.com>"   # browser dev tools > Application > Cookies
    python scripts/tiktok_stats.py xylo_mining --count 30

Writes data/tiktok_metrics.json (rows keyed by title). TikTok changes its data layout and blocks bots
(EmptyResponseException); if that happens, retry with a fresh ms_token or a proxy.
"""
import argparse
import asyncio
import json
import os
import pathlib

from TikTokApi import TikTokApi

OUT = pathlib.Path(__file__).resolve().parents[1] / "data" / "tiktok_metrics.json"


async def main(handle: str, count: int, browser: str, headed: bool = False):
    token = os.environ.get("ms_token")
    async with TikTokApi() as api:
        proxy = os.environ.get("TIKTOK_PROXY")  # optional, e.g. http://user:pass@host:port
        await api.create_sessions(ms_tokens=[token] if token else None, num_sessions=1, sleep_after=3, browser=browser,
                                  headless=not headed, proxies=[{"server": proxy}] if proxy else None)
        user = api.user(handle)
        info = await user.info()
        stats = info.get("userInfo", {}).get("stats", {})
        rows = []
        async for v in user.videos(count=count):
            d = v.as_dict
            s = d.get("stats", {})
            rows.append({
                "id": d.get("id"),
                "title": (d.get("desc") or "").split("\n")[0][:120],
                "created": d.get("createTime"),
                "duration": (d.get("video") or {}).get("duration"),
                "views": s.get("playCount"),
                "likes": s.get("diggCount"),
                "comments": s.get("commentCount"),
                "shares": s.get("shareCount"),
                "saves": s.get("collectCount"),
            })
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"account": {"handle": handle, "followers": stats.get("followerCount"),
                                           "likes": stats.get("heartCount"), "videos": stats.get("videoCount")},
                               "videos": rows}, indent=2))
    print(f"wrote {OUT} ({len(rows)} videos)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("handle")
    ap.add_argument("--count", type=int, default=30)
    ap.add_argument("--browser", default="chromium")
    ap.add_argument("--headed", action="store_true", help="visible browser (use xvfb-run on a server)")
    a = ap.parse_args()
    try:
        asyncio.run(main(a.handle.lstrip("@"), a.count, a.browser, a.headed))
    except Exception as e:  # print a plain reason so the CI log shows why it failed
        print(f"TIKTOK FETCH FAILED: {type(e).__name__}: {str(e)[:300]}")
        print("ms_token set:", bool(os.environ.get("ms_token")))
        raise SystemExit(1)
