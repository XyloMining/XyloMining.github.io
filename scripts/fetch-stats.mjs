// Builds stats.json (views, likes, followers per platform) for the feed page.
// YouTube: Data API channel totals when YOUTUBE_API_KEY is set, otherwise the sum of views in posts.json (recent videos only, so it never goes below the last known total).
// Instagram and TikTok: data/buffer_posts.json (per-post views, likes) from Buffer, written in the daily Claude update. Totals cover posts published through Buffer.
// Followers are not available from Buffer: they come from data/followers.json, else the last known value.
// TikTok falls back to data/tiktok_metrics.json (scripts/tiktok_stats.py) only if the Buffer file is missing.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const prev = read("stats.json");
const prevOf = (name) => prev?.platforms?.find((p) => p.platform === name);
const YT_CHANNEL = "UCXUPLb9x-nzQb-0H3A5WVow";
const empty = (platform, handle) => ({ platform, handle, followers: null, views: null, likes: null, videos: null });

async function youtube() {
  const old = prevOf("YouTube") ?? empty("YouTube", "@xylomining");
  const key = process.env.YOUTUBE_API_KEY;
  if (key) {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${YT_CHANNEL}&key=${key}`);
    if (r.ok) {
      const s = (await r.json()).items?.[0]?.statistics;
      if (s) return { ...old, handle: "@xylomining", followers: Number(s.subscriberCount), views: Number(s.viewCount), likes: null, videos: Number(s.videoCount) };
    } else console.warn("YouTube API", r.status);
  }
  const yt = (read("posts.json") ?? []).filter((p) => p.platform === "YouTube");
  if (!yt.length) return old;
  return { ...old, handle: "@xylomining", views: Math.max(yt.reduce((s, p) => s + (p.views ?? 0), 0), old.views ?? 0), videos: Math.max(yt.length, old.videos ?? 0) };
}

function fromBuffer(name, handle) {
  const old = { ...empty(name, handle), ...(prevOf(name) ?? {}), handle };
  const b = read("data/buffer_posts.json");
  const mine = (b?.posts ?? []).filter((p) => p.platform === name);
  if (!mine.length) return null;
  const f = read("data/followers.json")?.[name.toLowerCase()];
  return {
    platform: name, handle,
    followers: typeof f === "number" ? f : old.followers,
    views: mine.reduce((s, p) => s + (p.views ?? 0), 0),
    likes: mine.reduce((s, p) => s + (p.likes ?? 0), 0),
    videos: mine.length,
  };
}

function tiktok() {
  const old = { ...empty("TikTok", "@xylo_mining"), ...(prevOf("TikTok") ?? {}), handle: "@xylo_mining" };
  const viaBuffer = fromBuffer("TikTok", "@xylo_mining");
  if (viaBuffer) return viaBuffer;
  const t = read("data/tiktok_metrics.json");
  if (!t) return old;
  const sum = (k) => t.videos.reduce((s, v) => s + (v[k] ?? 0), 0);
  const a = t.account ?? {};
  return {
    platform: "TikTok", handle: "@" + (a.handle ?? "xylo_mining"),
    followers: a.followers ?? old.followers, views: t.videos.length ? sum("views") : old.views,
    likes: a.likes ?? (t.videos.length ? sum("likes") : old.likes), videos: a.videos ?? (t.videos.length || old.videos),
  };
}

const instagram = fromBuffer("Instagram", "@xylo_mining") ?? { ...empty("Instagram", "@xylo_mining"), ...(prevOf("Instagram") ?? {}) };
const platforms = [await youtube(), tiktok(), instagram];
const next = { updated: new Date().toISOString(), platforms };
const same = prev && JSON.stringify(prev.platforms) === JSON.stringify(platforms);
if (!same) writeFileSync("stats.json", JSON.stringify(next, null, 2) + "\n");
console.log(same ? "stats unchanged" : "wrote stats.json", platforms);
