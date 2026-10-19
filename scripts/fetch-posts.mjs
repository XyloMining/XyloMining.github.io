// Refreshes posts.json (YouTube + Reddit) and articles.json (Medium) for the site.
// TikTok is not included: its posts need private API keys that are not available to this job.
import { readFileSync, writeFileSync } from "node:fs";

const YT_CHANNEL = "UCXUPLb9x-nzQb-0H3A5WVow";
const UA = "Mozilla/5.0 (XyloMiningSite)";
const MEDIUM_FEEDS = ["https://xylomining.medium.com/feed", "https://medium.com/feed/@xylomining"];
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const noDash = (s) => s.replace(/\s\u2014\s/g, ": ").replace(/\u2014/g, "-");

async function youtube() {
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

const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return fallback; } };

// posts.json
const results = await Promise.allSettled([youtube(), reddit()]);
results.forEach((r, i) => r.status === "rejected" && console.warn(["YouTube", "Reddit"][i], r.reason?.message));
const posts = results
  .flatMap((r) => (r.status === "fulfilled" ? [...r.value].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3) : []))
  .sort((a, b) => b.date.localeCompare(a.date));
// Keep the previous file if every source failed, so a blocked request never wipes the feed.
if (posts.length) writeFileSync("posts.json", JSON.stringify(posts, null, 2) + "\n");
console.log(`posts: ${posts.length}`);

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
