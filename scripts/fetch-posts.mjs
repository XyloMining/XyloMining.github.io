// Refreshes posts.json (YouTube + Reddit) and articles.json (Medium) for the site.
// One file per platform: postsyt.json, postsrd.json (written here, accumulated), postsig.json, poststt.json (written by scripts/buffer_to_json.py in the daily Claude update) and postsx.json.
// posts.json is a short combined list kept only for the older site build that reads one file.
import { readFileSync, writeFileSync } from "node:fs";

const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return fallback; } };
const YT_CHANNEL = "UCXUPLb9x-nzQb-0H3A5WVow";
const UA = "Mozilla/5.0 (XyloMiningSite)";
const MEDIUM_FEEDS = ["https://xylomining.medium.com/feed", "https://medium.com/feed/@xylomining"];
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const noDash = (s) => s.replace(/\s\u2014\s/g, ": ").replace(/\u2014/g, "-");

async function youtubeApi(key) {
  const uploads = "UU" + YT_CHANNEL.slice(2);
  const list = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=10&playlistId=${uploads}&key=${key}`);
  if (!list.ok) throw new Error(`YouTube API playlist ${list.status}`);
  const ids = ((await list.json()).items ?? []).map((i) => i.contentDetails.videoId);
  if (!ids.length) return [];
  const vids = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids.join(",")}&key=${key}`);
  if (!vids.ok) throw new Error(`YouTube API videos ${vids.status}`);
  return ((await vids.json()).items ?? []).map((v) => ({
    id: `yt-${v.id}`, platform: "YouTube", title: noDash(v.snippet.title),
    url: `https://www.youtube.com/watch?v=${v.id}`, date: v.snippet.publishedAt,
    thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    views: Number(v.statistics?.viewCount ?? 0), likes: Number(v.statistics?.likeCount ?? 0), comments: Number(v.statistics?.commentCount ?? 0),
  }));
}

async function youtubeRss() {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`YouTube feed ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const e = m[1] ?? "";
    const id = e.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1] ?? "";
    return {
      id: `yt-${id}`, platform: "YouTube",
      title: noDash(decode(e.match(/<title>(.*?)<\/title>/)?.[1] ?? "Video")),
      url: `https://www.youtube.com/watch?v=${id}`,
      date: e.match(/<published>(.*?)<\/published>/)?.[1] ?? "",
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      views: Number(e.match(/<media:statistics views="(\d+)"/)?.[1] ?? 0),
      likes: Number(e.match(/<media:starRating count="(\d+)"/)?.[1] ?? 0),
    };
  });
}

async function youtube() {
  try {
    return await youtubeRss();
  } catch (e) {
    if (!process.env.YOUTUBE_API_KEY) throw e;
    console.warn("YouTube RSS failed, using the Data API:", e.message);
    return youtubeApi(process.env.YOUTUBE_API_KEY);
  }
}

async function reddit() {
  const res = await fetch("https://www.reddit.com/user/Xylo_mining/submitted.json?limit=10", { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Reddit ${res.status}`);
  const json = await res.json();
  return (json.data?.children ?? []).map(({ data: d }) => ({
    id: `rd-${d.id}`, platform: "Reddit", title: noDash(d.title),
    url: `https://www.reddit.com${d.permalink}`,
    date: new Date(d.created_utc * 1000).toISOString(),
    likes: d.score, comments: d.num_comments,
  }));
}

async function medium() {
  for (const feed of MEDIUM_FEEDS) {
    try {
      const res = await fetch(feed, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
        const e = m[1] ?? "";
        const cdata = (tag) => e.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))?.[1]?.trim() ?? "";
        const content = e.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/)?.[1] ?? "";
        const img = content.match(/<img[^>]+src="([^"]+)"/)?.[1];
        const pub = cdata("pubDate");
        return {
          title: noDash(decode(cdata("title"))),
          url: cdata("link").split("?")[0],
          thumbnail: img ? decode(img) : undefined,
          date: pub ? new Date(pub).toISOString() : "",
        };
      });
      if (items.length) return items;
    } catch {}
  }
  throw new Error("Medium feed unavailable");
}


// posts.json
const results = await Promise.allSettled([youtube(), reddit()]);
results.forEach((r, i) => r.status === "rejected" && console.warn(["YouTube", "Reddit"][i], r.reason?.message));
const write = (f, rows) => writeFileSync(f, JSON.stringify(rows, null, 2) + "\n");
const COUNTS = ["views", "likes", "comments"];
// The per-platform files are a growing data set: posts are matched by id and never removed, and counts never go down.
function accumulate(file, fresh) {
  const merged = new Map(readJson(file, []).map((p) => [p.id, p]));
  for (const f of fresh) {
    const old = merged.get(f.id) ?? {};
    const next = { ...old, ...f };
    for (const k of COUNTS) if (old[k] !== undefined || f[k] !== undefined) next[k] = Math.max(old[k] ?? 0, f[k] ?? 0);
    merged.set(f.id, next);
  }
  const rows = [...merged.values()].sort((a, b) => b.date.localeCompare(a.date));
  write(file, rows);
  return rows;
}
// A source that failed leaves its file as it was.
if (results[0].status === "fulfilled") accumulate("postsyt.json", results[0].value);
if (results[1].status === "fulfilled") accumulate("postsrd.json", results[1].value);

// posts.json is only for the older site build that reads one file: the 5 newest and the top post of each platform.
const score = (p) => (p.views ?? 0) * 1e6 + (p.likes ?? 0);
const shown = ["yt", "rd", "ig", "tt", "x"].flatMap((k) => {
  const all = readJson(`posts${k}.json`, []).sort((a, b) => b.date.localeCompare(a.date));
  const top = [...all].sort((a, b) => score(b) - score(a))[0];
  const recent = all.slice(0, 5);
  return top && !recent.includes(top) ? [...recent, top] : recent;
});
const posts = shown.sort((a, b) => b.date.localeCompare(a.date));
if (posts.length) write("posts.json", posts);
console.log(`posts: ${posts.length}`);
if (!posts.length) {
  console.error("No posts fetched from any source. Check the warnings above.");
  process.exitCode = 1;
}

// articles.json: keep hand-written fields (like subtitle) from the previous file
try {
  const prev = readJson("articles.json", []);
  const fresh = await medium();
  const merged = fresh.map((a) => {
    const old = prev.find((p) => p.url === a.url);
    return { ...a, thumbnail: a.thumbnail ?? old?.thumbnail, ...(old?.subtitle ? { subtitle: old.subtitle } : {}) };
  });
  // Keep older articles that have dropped out of the feed's short window.
  for (const p of prev) if (!merged.some((a) => a.url === p.url)) merged.push(p);
  writeFileSync("articles.json", JSON.stringify(merged, null, 2) + "\n");
  console.log(`articles: ${merged.length}`);
} catch (e) {
  console.warn("articles not refreshed:", e.message);
}
