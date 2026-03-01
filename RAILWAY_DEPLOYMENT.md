# Railway Deployment Guide - Shopify Sales Exporter

## Overview
Deploy the Shopify Sales Exporter to Railway with PostgreSQL session storage
and a custom domain at `sales.pandorasdeckbox.com`.

---

## Step 1: Create a New Service in Railway

Since you already have a Railway project for the Inventory system, you can add this as a
**new service** in the same project, or create a separate project.

### Option A: Same Project (Recommended - shares billing)
1. Go to https://railway.app/dashboard
2. Open your existing `pandoras-card-inventory` project
3. Click **"+ New"** → **"GitHub Repo"**
4. Select `pandorasdeckbox/shopify-sales-exporter`
5. Railway will auto-detect it as a Node.js app

### Option B: Separate Project
```bash
cd "/Users/adamfehnel/Desktop/Scripts/shopify-sales-exporter"
railway login
railway init
# Choose "Create a new project", name it "shopify-sales-exporter"
railway link
```

---

## Step 2: Add PostgreSQL Database

The app needs PostgreSQL for persistent session storage (Railway's filesystem is ephemeral).

1. In your Railway project, click **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Railway will automatically set the `DATABASE_URL` environment variable
3. That's it! The app auto-detects the Postgres URL and creates the sessions table on startup.

> **Note**: If you add Postgres as a separate service, you may need to manually copy the
> `DATABASE_URL` from the Postgres service's variables into the app service's variables.

---

## Step 3: Set Environment Variables

In the Railway dashboard, go to your sales exporter service → **Variables** tab.

Add these variables:

| Variable | Value |
|---|---|
| `SHOPIFY_API_KEY` | `eecc8703883a4a056400f6e47c8978a8` |
| `SHOPIFY_API_SECRET` | *(your Shopify API secret - from Partner Dashboard)* |
| `APP_URL` | `https://sales.pandorasdeckbox.com` |
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | *(generate with `openssl rand -base64 32`)* |

> `PORT` is automatically set by Railway — don't set it manually.
> `DATABASE_URL` is automatically set by the PostgreSQL plugin.

---

## Step 4: Configure Custom Domain

### In Railway:
1. Go to your sales exporter service → **Settings** tab
2. Under **Networking** → **Public Networking**, click **"+ Custom Domain"**
3. Enter: `sales.pandorasdeckbox.com`
4. Railway will show you a **CNAME target** (something like `xyz.up.railway.app`)

### In Your DNS (wherever pandorasdeckbox.com is managed):
1. Add a **CNAME record**:
   - **Name**: `sales`
   - **Target**: *(the Railway CNAME target from above)*
   - **TTL**: Auto or 300

2. Wait for DNS propagation (usually 5-15 minutes)
3. Railway will automatically provision an SSL certificate

---

## Step 5: Update Shopify Partner Dashboard

**This is critical** — Shopify needs to know the new URL.

1. Go to https://partners.shopify.com
2. Open your app → **App setup**
3. Update these URLs:
   - **App URL**: `https://sales.pandorasdeckbox.com/app`
   - **Allowed redirection URL(s)**: `https://sales.pandorasdeckbox.com/auth/callback`
4. Save changes

---

## Step 6: Deploy

### If using GitHub integration (recommended):
Railway auto-deploys on every push to `main`:
```bash
cd "/Users/adamfehnel/Desktop/Scripts/shopify-sales-exporter"
git add -A
git commit -m "Add Railway deployment support"
git push origin main
```

### If using Railway CLI:
```bash
cd "/Users/adamfehnel/Desktop/Scripts/shopify-sales-exporter"
railway up
```

---

## Step 7: Re-authenticate Shopify

After the first deploy, you'll need to re-install the app since the OAuth tokens
from the old ngrok/cloudflare tunnel URL won't work:

1. Go to your Shopify admin: `https://pandoras-deck-box.myshopify.com/admin`
2. Go to **Settings** → **Apps and sales channels**
3. If the app is listed, remove it
4. Re-install via: `https://sales.pandorasdeckbox.com/auth?shop=pandoras-deck-box.myshopify.com`

---

## Verify Deployment

1. Check Railway logs for: `Shopify Sales Exporter running on port XXXX`
2. Visit: `https://sales.pandorasdeckbox.com/health` — should return `{"status":"ok"}`
3. Visit: `https://sales.pandorasdeckbox.com/app?shop=pandoras-deck-box.myshopify.com`

---

## Troubleshooting

### "Session not found" errors
The PostgreSQL database needs to have the session from OAuth. Re-authenticate by visiting:
`https://sales.pandorasdeckbox.com/auth?shop=pandoras-deck-box.myshopify.com`

### OAuth redirect errors
Make sure the **Allowed redirection URL** in Shopify Partner Dashboard exactly matches:
`https://sales.pandorasdeckbox.com/auth/callback`

### Database connection errors
Check that `DATABASE_URL` is set in Railway variables. If you added Postgres as a separate
service, you need to reference it. Go to Postgres service → **Connect** tab → copy the
connection string.

### App not loading in Shopify admin
The `APP_URL` env var must match what's in the Shopify Partner Dashboard.
Both should be `https://sales.pandorasdeckbox.com`.
