// Refreshes posts.json from YouTube and Reddit (same sources and shape as the Lovable site's feed).
// TikTok is not included: the Lovable version reads it through a Lovable connector with private keys.
import { writeFileSync } from "node:fs";

const YT_CHANNEL = "UCXUPLb9x-nzQb-0H3A5WVow";
const UA = "Mozilla/5.0 (XyloMiningSite)";
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function youtube() {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL}`, { headers: { "User-Agent": UA } });
  if (!res.ok) return [];
  const xml = await res.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const e = m[1] ?? "";
    const id = e.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1] ?? "";
    return {
      id: `yt-${id}`, platform: "YouTube",
      title: decode(e.match(/<title>(.*?)<\/title>/)?.[1] ?? "Video"),
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
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data?.children ?? []).map(({ data: d }) => ({
    id: `rd-${d.id}`, platform: "Reddit", title: d.title,
    url: `https://www.reddit.com${d.permalink}`,
    date: new Date(d.created_utc * 1000).toISOString(),
    likes: d.score, comments: d.num_comments,
  }));
}

const results = await Promise.allSettled([youtube(), reddit()]);
const posts = results
  .flatMap((r) => (r.status === "fulfilled" ? [...r.value].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3) : []))
  .sort((a, b) => b.date.localeCompare(a.date));
// Keep the previous file if every source failed, so a blocked request never wipes the feed.
if (posts.length) writeFileSync("posts.json", JSON.stringify(posts, null, 2) + "\n");
console.log(`posts: ${posts.length}`);
