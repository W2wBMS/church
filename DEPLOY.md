# Christian Mission Dunamis — Production Deployment Runbook

This runbook documents two hosting routes:

- **Managed testing setup (no custom domain):** Netlify hosts the static frontend and Render hosts the API and PostgreSQL. Provider subdomains supply HTTPS.
- **VPS production setup:** Vercel hosts the static frontend and a Contabo VPS hosts the API, PostgreSQL, and nginx/TLS using Docker Compose.

```
Browser ──HTTPS──► Netlify or Vercel (static SPA)
                         │
                         └──HTTPS──► Render or VPS API ──► PostgreSQL
```

The frontend also runs **standalone** (localStorage demo) when no API is configured. An API-backed deployment requires a separately deployed API, PostgreSQL, and a real account provisioned in that database.

> Architecture note: the API enforces auth + RBAC + campus scoping **server-side** (a branch admin cannot read another campus even by tampering with requests). Secrets come only from environment variables; nothing sensitive is committed.

---

## Managed testing setup — Netlify + Render (no custom domain)

Use this route if you have Netlify and Render accounts but do not own a domain.
Netlify and Render provide HTTPS subdomains. This is suitable for a temporary
test, not for important church data: Render's Free web services spin down when
idle, and Free Render Postgres databases expire after 30 days. Check Render's
current plan limits before creating resources; do not store important data on
an expiring test database.

### 1. Deploy the frontend to Netlify

1. Push the repository to a Git provider accessible to Netlify.
2. In Netlify, create a site by importing that repository.
3. Use the repository root as the base directory. Leave the build command
   empty and publish `.`. These settings are also in `netlify.toml`.
4. Deploy the site and copy its primary HTTPS URL, for example
   `https://your-site-name.netlify.app`.

At this stage the frontend is in standalone mode. Do not enter the browser
demo's `admin@...` / `grace` credentials expecting them to authenticate against
the API.

### 2. Create PostgreSQL on Render

1. In Render, create a PostgreSQL database and select the lowest-cost/free
   plan available for testing.
2. Choose a region and record it; the API service must use the same region.
3. Keep the database's internal connection URL private. It will be linked to
   the API service as `DATABASE_URL`.

Free PostgreSQL is temporary and can expire after 30 days. Back up anything
you need before that deadline; use a paid persistent database for data you
intend to keep.

### 3. Deploy the API on Render

1. Create a Render **Web Service** from the same repository.
2. Set the runtime to **Docker**, the root directory to `server`, and select
   the same region as the database.
3. Set the health check path to `/api/health`.
4. Add these environment variables in the Render service settings:

   | Key | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | Link the Render database's **internal** connection URL. |
   | `PGSSL` | `require` |
   | `JWT_SECRET` | A unique random secret of at least 32 characters. Do not reuse a repository or database password. |
   | `JWT_EXPIRES_IN` | `12h` |
   | `BCRYPT_ROUNDS` | `12` |
   | `CORS_ORIGINS` | The exact Netlify HTTPS origin from step 1, with no trailing slash. |
   | `MFA_DEMO_CODE` | A temporary six-digit test code; this is not production MFA. |

   A random secret can be generated locally with Node.js:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
   ```

   Paste the output into Render's secret environment-variable field. Do not
   commit it or share it in chat.

5. Deploy the service. The Dockerfile applies the database schema before
   starting the API.
6. Copy the Render service's HTTPS URL, then open
   `https://<render-service>.onrender.com/api/health`. Confirm it returns
   `{"status":"ok","db":"up"}`.

The migration creates tables and canonical campuses, but **does not create
demo users or an administrator**. The browser-only demo credentials do not
exist in the Render database. The app currently has no public admin-creation
screen; provision an authorized test administrator through a secure database
administration process before testing the admin console. Never make a public
bootstrap endpoint or expose database credentials to the browser.

### 4. Connect Netlify to the Render API

After the API URL is available:

1. Edit `js/config.js`. Keep the localhost setting for local development and
   replace the deployed empty-string fallback with the Render HTTPS origin.
   For example, change:

   ```js
   || (isLocalHost ? 'http://localhost:4000' : ''),
   ```

   to:

   ```js
   || (isLocalHost ? 'http://localhost:4000' : 'https://your-api.onrender.com'),
   ```

   Use your actual Render service URL, with no `/api` suffix and no trailing
   slash. The existing localStorage override still takes precedence.
2. Commit and push this change. Netlify will publish the new configuration.
3. In Render, verify `CORS_ORIGINS` exactly matches the public Netlify site
   origin, then redeploy/restart the API if you changed it.
4. Open the Netlify site and test the login with the administrator account
   provisioned in the Render database. The API's demo MFA verifier expects the
   `MFA_DEMO_CODE` value.

If a Netlify deploy-preview URL is used for testing, add that exact origin to
`CORS_ORIGINS` as an additional comma-separated value. Keep the list limited
to origins you control.

### 5. Testing limitations

- Render Free web services may take about a minute to wake after inactivity.
- Render Free Postgres expires after 30 days; it is not suitable for retained
  member or giving records.
- This repository's MFA check is a fixed demo-code verifier, not real TOTP or
  SMS verification.
- Giving endpoints record contributions; they do not charge a payment method.
- Announcement endpoints store announcement records; they do not deliver
  email, SMS, or push notifications.
- Do not use this test deployment for confidential or production church data.

---

## Prerequisites

- A domain you control, with two DNS records:
  - `app.yourchurch.org` (or an apex) → managed by Vercel (frontend)
  - `api.yourchurch.org` → **A record → your Contabo VPS IP** (backend)
- Contabo VPS (Ubuntu 22.04/24.04) with Docker + Docker Compose installed:
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```
- The Vercel CLI locally (`npm i -g vercel`) or the Vercel dashboard.

---

## Part A — Backend on Contabo

1. **Copy the repo to the VPS** (git clone, or scp the `server/` and `deploy/` folders).

2. **Configure secrets**:
   ```bash
   cd deploy
   cp .env.example .env
   # Edit .env:
   #   PGPASSWORD   — a strong DB password
   #   JWT_SECRET   — openssl rand -hex 48
   #   CORS_ORIGINS — your Vercel URL, e.g. https://app.yourchurch.org
   ```

3. **Point nginx at your API domain**: edit `deploy/nginx/conf.d/church2-api.conf` and replace every `api.yourchurch.org` with your real API subdomain.

4. **Obtain the TLS certificate** (one-time). First bring up nginx on port 80 so certbot can answer the ACME challenge:
   ```bash
   mkdir -p certbot/www certbot/conf
   docker compose up -d nginx
   docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
     -d api.yourchurch.org --email you@yourchurch.org --agree-tos --no-eff-email
   docker compose restart nginx
   ```

5. **Start the stack**:
   ```bash
   docker compose up -d --build
   ```
   The API container runs migrations automatically on start.

6. **Provision the initial administrator** using your approved secure account-provisioning process. Migrations create the schema only; this project does not seed demo records or demo login accounts.

7. **Verify**:
   ```bash
   curl https://api.yourchurch.org/api/health          # {"status":"ok","db":"up"}
   ```

Certbot auto-renews certificates every 12h; nginx picks up renewed certs on reload.

---

## Part B — Frontend on Vercel

1. From the repo root:
   ```bash
   vercel            # first run: link the project
   vercel --prod     # deploy to production
   ```
   (Or import the GitHub repo in the Vercel dashboard — `vercel.json` and `.vercelignore` are already configured to publish the root as a static site and exclude `server/`/`deploy/`.)

2. **Connect the frontend to the API.** Set the API base URL in `js/config.js`:
   ```js
   window.CHURCH2_CONFIG = { apiBase: "https://api.yourchurch.org" };
   ```
   Commit + redeploy. (For a quick test without editing the file, open the app and run
   `localStorage.setItem('church2_api_base','https://api.yourchurch.org')` in the console, then reload.)

3. **Lock CORS down**: ensure `CORS_ORIGINS` in the Contabo `.env` is exactly your Vercel production URL, then `docker compose up -d` to apply.

---

## Verify the whole path

Open the Vercel URL and sign in with the HQ administrator provisioned for the API, using the configured MFA code.
You should see real data served from Postgres on Contabo. A wrong password is rejected by the server; a branch admin only ever sees their own campus.

---

## Security checklist before real launch

- [ ] Provision real staff accounts; the API does not create demo accounts or sample records.
- [ ] Swap the mock MFA (`MFA_DEMO_CODE`) for real TOTP (the `/auth/mfa` step is structured for this).
- [ ] Strong, unique `JWT_SECRET` and `PGPASSWORD` (never commit `.env`).
- [ ] `CORS_ORIGINS` restricted to your exact frontend origin (no `*`).
- [ ] Enable automated Postgres backups (e.g. `pg_dump` cron to Contabo object storage).
- [ ] Add real payment processing (Stripe/Tithe.ly) for live giving — currently receipts are recorded, not charged.

---

## What's wired vs. remaining

**Done & verified:** real auth (bcrypt + JWT + MFA step), RBAC + server-side campus scoping, and REST endpoints for members, transactions/giving, attendance, dashboard summary, groups, follow-ups, announcements, prayer requests, and events. When an `apiBase` is configured the whole UI is **backend-backed**: on login the app hydrates `this.db` from Postgres (so every view renders shared, real data), and every mutation — recording a gift, marking attendance, enrolling a member, moving a follow-up, creating/joining a group, sending a broadcast, submitting/dismissing a prayer request — is mirrored to the API and persisted. Writes are optimistic (the UI updates instantly) and reconcile the server-assigned id; a failed sync surfaces a toast rather than silently dropping. With no `apiBase` set the same code runs standalone against localStorage (demo mode). All paths were verified end-to-end against a live Postgres, including that a branch admin cannot read or write outside their own campus even by tampering with `?branch=`.

**Remaining increment:** add live payment processing so giving is charged, not just recorded. For this client that means an **M-Pesa Daraja** integration (STK push + C2B confirmation callback) against the church's own paybill, with a card fallback. A few client-only conveniences without server endpoints yet — recurring-gift schedules, scripture reading streaks, and event volunteer sign-ups — remain local until matching endpoints are added; everything else is backend-backed.

---

## Client configuration (Christian Mission Dunamis)

Everything client-specific lives in **two places**, by design:

| What | Where |
|---|---|
| Church name, tagline, website, currency, campuses, ministries, service times, M-Pesa paybill, card fee rates | `js/brand.js` |
| Brand palette (`--mmc-royal`, `--mmc-royal-light`, `--mmc-gold`, `--mmc-gold-deep`) | top of `styles.css` `:root` |

To rebrand for another church, change those two files — no other file hardcodes the client's identity, colours or currency. The palette hex values are mirrored in `js/brand.js` under `palette` so charts (canvas-drawn, can't read CSS) stay in sync.

### Live demo

The frontend deploys to Vercel automatically from `main` via
`.github/workflows/vercel.yml`, which needs one repository secret,
`VERCEL_TOKEN`. Project: **mmc-ministry-console**.

    https://mmc-ministry-console.vercel.app

With no `apiBase` configured the deploy runs in standalone localStorage demo
mode — no backend required. For the API-backed deployment, sign in with the
HQ administrator provisioned for that database and its configured MFA code.

> **New Vercel projects ship with Deployment Protection on**, which puts a
> Vercel login in front of the URL. Before sending the link to the church, turn
> it off under Project → Settings → Deployment Protection, or the recipient
> will hit an auth wall instead of the app.

### Changes from the 17 Aug 2026 requirements meeting

| Agreed | Where it lives |
|---|---|
| Only the administrator may add or remove members | `ChurchApp.isAdmin()` gates the UI; `handleCreateMember` / `removeMember` re-check; the API enforces it with `requireRole('hq_admin','branch_admin')` on `POST /members` and `DELETE /members/:id` |
| One person logged in at a time | `users.token_version` is bumped by `issueSession()` on every login and checked in `authenticate()`; an older token gets `401 session_superseded` and the client returns to the login screen |
| Registration captures marital status, previous activities/work/experience, and expectations | `members.marital_status`, `members.background`, `members.expectations`; shown on the member profile |
| Money independent of projects, attendance and activities | The Financials tab leads with **Total Contributions** and **Individual Contributions**, computed from the transaction ledger alone. Project fundraising no longer derives its progress from giving — see the open question below |
| Attendance simplified; roles listed beside names; how members arrived | Role pill per row, whole-row check-in, search, mark-all/clear-all, and an `arrival_mode` column (Car, Motorcycle (boda), Bicycle, Walked, Other) with a breakdown panel |

**Open for Thursday 20 Aug:** pledge campaigns used to show progress by summing
giving in a matching fund — precisely the money-to-project link the meeting
asked us to break — so the cards are gone from the money section. The campaign
records are still in the database, untouched. The decision to make is whether
project fundraising disappears entirely, or reappears somewhere outside the
financial section with its own totals.

### Before go-live, confirm with the church

- [ ] **M-Pesa paybill / account number.** `js/brand.js` ships `paybill: '891300'` with `shortCodeConfirmed: false` — a placeholder. Replace it with the church's real short code and flip the flag. **Until that flag is `true` the giving screen deliberately shows no number at all**, just a "not live yet, give in person or by bank transfer" notice — a plausible-but-wrong paybill is how a member's tithe reaches a stranger's account.
- [ ] **Exact brand hex codes** and a vector logo, if the church's designer has them. The current royal-and-gold palette was set from public brand material.
- [ ] **Campus addresses and service times** in `js/brand.js` (`campuses`, `services`).
- [ ] **Real staff accounts** — provision staff accounts for the live API; it has no seeded demo logins.
