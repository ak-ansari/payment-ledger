# Deploying (free)

The repo is set up to deploy on **Render's free tier** as two services — the API
(a free Node web service) and the UI (a free static site) — wired together by the
`render.yaml` blueprint at the repo root. Render is genuinely free (no credit card)
for this; the only catch is the free web service sleeps after ~15 min idle and
takes ~30–50s to wake on the next request.

## Step 1 — put the repo on GitHub

Render deploys from a Git repo, and you need this for the submission anyway. From
the repo root:

```bash
git init
git add .
git commit -m "Mini payment ledger & invoice service"
git branch -M main
git remote add origin https://github.com/<you>/tms-payment-ledger.git
git push -u origin main
```

## Step 2 — deploy the blueprint on Render

1. Sign in at https://render.com with your GitHub account (free).
2. **New → Blueprint**, pick this repo. Render reads `render.yaml` and proposes two
   services: `tms-ledger-api` and `tms-ledger-web`.
3. Click **Apply**. The API builds and starts first; the static site builds after
   and picks up the API's hostname via `VITE_API_URL` automatically.
4. When both are live you'll get two URLs. The one to share / submit as the "hosted
   UI" is **`tms-ledger-web`** (e.g. `https://tms-ledger-web.onrender.com`).

That's it. Open the web URL; it talks to the API service. (First request after idle
is slow while the API wakes — expected on the free tier.)

## If the auto-wired API URL doesn't take

Render can't always template a full `https://` URL from one service into another at
build time. If the UI can't reach the API, set it manually:

1. Copy the API URL from its Render page (e.g. `https://tms-ledger-api.onrender.com`).
2. On the `tms-ledger-web` service → **Environment**, set
   `VITE_API_URL` to that full URL.
3. **Manual Deploy → Clear build cache & deploy** so the value is baked into the
   build.

(The frontend accepts the value with or without the `https://` prefix, so either
form works.)

## Notes / caveats

- **Data is ephemeral.** The free tier has no persistent disk, so the SQLite file
  resets on redeploy or sleep. The system accounts (Cash, A/R, Revenue) re-seed on
  every start, so the app is always usable — but invoices you create won't survive a
  restart. Fine for a demo; for durable data you'd attach a paid disk or move to
  Postgres.
- **Cold starts.** ~30–50s on the first hit after idle. Nothing you can do about it
  on the free plan.
- **CORS** is already open (`*`) on the API, so the separate UI origin works without
  extra config.

## Alternative: Fly.io (persistent SQLite)

If you want the data to survive restarts, Fly.io's free allowance plus a small
volume works. It's more setup (Docker + `fly` CLI + `fly auth login`), so Render is
the recommended path unless persistence matters. Ask if you want the Fly config.
