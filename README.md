# Xylo Mining

The website for **Xylo Mining**: GoMining and Bitcoin mining content, links to every account, and referral codes in one place.

Live at **https://xylomining.github.io**

## Pages

| Page | What it shows |
| --- | --- |
| `/` | Hero, links to all accounts, latest posts, referral codes |
| `/articles` | The recommended article, then every Medium article with its thumbnail |
| `/feed` | Latest posts, with tabs for All, YouTube, TikTok and X |
| `/referrals` | Referral codes for GoMining, Kryptex, Coinbase and Coinbase Wallet |

It supports light, dark and system themes.

## How it works

This repo holds the **built, static site** that GitHub Pages serves from the `main` branch root. There is no server.

- `index.html`, `feed/`, `referrals/` and `assets/` are the build output. Do not edit them by hand.
- `posts.json` holds the latest posts and `articles.json` the Medium articles shown on the site.
- `scripts/fetch-posts.mjs` rebuilds `posts.json` from the YouTube channel feed and Reddit, and `articles.json` from the Medium feed. Each file keeps its previous contents if its sources fail.
- `.github/workflows/refresh-posts.yml` runs that script every 3 hours and commits any change. Run it on demand from the Actions tab with **Run workflow**.

TikTok posts are not included, because they need private API keys.

## Updating the site

The site source is a TanStack Start and React project in the private repo `XyloMining/gomining-bitcoin-social-hub`. To publish a change:

1. Edit the source and run the static build: `npx vite build --config vite.pages.config.ts`.
2. Copy the contents of `dist/client/` into this repo, keeping `posts.json`, `scripts/` and `.github/`.
3. Commit and push to `main`. Pages redeploys within a minute or two.

## Disclosure

Referral links on the site may earn Xylo Mining a reward at no cost to you. Nothing here is financial advice. Mining carries risk and results vary.


Also: `/guides` (searchable mining guides) and `/calculator` (Bitcoin and GoMining profitability calculator).
