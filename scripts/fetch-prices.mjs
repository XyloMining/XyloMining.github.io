// Writes prices.json for the calculator: BTC in several currencies and the GOMINING token in dollars.
// Source: CoinGecko keyless public API (no API key). One request per run, run every 6 hours.
// CoinGecko API IDs: "bitcoin" and "gmt-token" (the GoMining token, ticker GOMINING).
import { readFileSync, writeFileSync } from "node:fs";

const URL = process.env.PRICES_URL ??
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,gmt-token&vs_currencies=usd,aud,eur,gbp,cad,chf,jpy&precision=full";
const CURRENCIES = ["usd", "aud", "eur", "gbp", "cad", "chf", "jpy"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get() {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(URL, { headers: { accept: "application/json", "user-agent": "XyloMiningSite/1.0" } });
      if (res.status === 429 || res.status >= 500) throw new Error(`CoinGecko ${res.status}`);
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(2000 * 2 ** attempt); // back off: 2s, 4s, 8s, 16s
    }
  }
  throw lastErr;
}

const data = await get();
const btc = {};
for (const c of CURRENCIES) {
  const v = Number(data?.bitcoin?.[c]);
  if (!(Number.isFinite(v) && v > 0)) throw new Error(`Missing or invalid BTC price in ${c}`);
  btc[c] = v;
}
const gmtUsd = Number(data?.["gmt-token"]?.usd);
if (!(Number.isFinite(gmtUsd) && gmtUsd > 0)) throw new Error("Missing or invalid GOMINING price in usd");

const next = { updatedAt: new Date().toISOString(), source: "CoinGecko", btc, gmt: { usd: gmtUsd } };

// Keep the old file's timestamp if nothing moved, so the commit step has nothing to do.
try {
  const old = JSON.parse(readFileSync("prices.json", "utf8"));
  if (JSON.stringify({ ...old, updatedAt: 0 }) === JSON.stringify({ ...next, updatedAt: 0 })) process.exit(0);
} catch {}
writeFileSync("prices.json", JSON.stringify(next, null, 2) + "\n");
console.log("prices.json updated", next);
