# Baby Arrival Plan

A private planner for two: tasks timed to pregnancy weeks, a kit register by zone, packable caddies, and a budget roll-up. Static site on Vercel; data and logins in Supabase.

## How it fits together

- `index.html`, `styles.css`, `app.js`: the whole app; no build step.
- `config.js`: Supabase URL and publishable key. Both are safe to ship to the browser.
- `vendor/`: the Supabase JS client (v2.117.2), bundled so the site has no third-party script dependencies.
- `supabase/seed.sql`: the starting tasks, kit and caddies (already loaded).

## Security model

- Only emails in `private.allowed_emails` can create an account. A trigger on `auth.users` rejects anyone else.
- Every table has row-level security: signed-in users see data only if their email is on that list. Anonymous requests are refused.
- To invite someone, run in the Supabase SQL editor:
  `insert into private.allowed_emails(email) values ('name@example.com');`

## Deploy

1. In Vercel: Add New → Project → import this GitHub repo. Framework preset: Other. No build command; output directory is the repo root.
2. In Supabase → Authentication → URL Configuration: set Site URL to your Vercel URL and add it under Redirect URLs.
3. Open the site, enter your email and a password, and tap Create account. Confirm via the email link, then sign in.

Every push to `main` redeploys automatically.
