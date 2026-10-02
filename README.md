# Baby Arrival Plan

A private planner for two: tasks timed to pregnancy weeks, a kit register by zone, packable caddies, and a budget roll-up. Static site on Vercel; data and logins in Supabase.

## How it fits together

- `index.html`, `styles.css`, `app.js`: the whole app; no build step.
- `config.js`: Supabase URL and publishable key. Both are safe to ship to the browser.
- `vendor/`: the Supabase JS client (v2.117.2), bundled so the site has no third-party script dependencies.
- `supabase/seed.sql`: the starting tasks, kit and caddies (already loaded).

## Access model

- No accounts. The private link ends in `#k=<code>`; the app sends that code with every request and the database checks it (row-level security on every table).
- Without the code, the database returns nothing, even to someone who has the site address.
- Opening the full link once stores the code on that device, so the plain address works there afterwards.
- To change the code (e.g. if the link leaks), run in the Supabase SQL editor:
  `update private.plan_key set key = '<new long random code>';` then use the new link.
- Sign-ups are disabled at the database.

## Deploy

1. In Vercel: Add New → Project → import this GitHub repo. Framework preset: Other. No build command; output directory is the repo root.
2. Open `https://<your-vercel-url>/#k=<code>` on each phone and bookmark it.

Every push to `main` redeploys automatically.

## Updating

When you change `styles.css`, `app.js`, `config.js` or the icon, bump the `?v=` number on their links in `index.html` so phones load the new files instead of cached copies.
