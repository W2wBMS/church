# Christian Mission Dunamis — Production Deployment Runbook

This runbook uses Supabase PostgreSQL as the only application database:

- **Managed testing setup (no custom domain):** Netlify hosts the static frontend, Render hosts the API, and Supabase hosts PostgreSQL.
- **VPS production setup:** Vercel hosts the static frontend, a Contabo VPS hosts the API and nginx/TLS using Docker Compose, and Supabase hosts PostgreSQL.

```
Browser ──HTTPS──► Netlify or Vercel (static SPA)
                         │
                         └──HTTPS──► Render or VPS API ──► Supabase PostgreSQL
```

The frontend also runs **standalone** (localStorage demo) when no API is configured. An API-backed deployment requires a separately deployed API, a Supabase project, and a real account provisioned in that database.

> Architecture note: the API enforces auth + RBAC + campus scoping **server-side** (a branch admin cannot read another campus even by tampering with requests). Secrets come only from environment variables; nothing sensitive is committed.

---

## Managed testing setup — Netlify + Render + Supabase (no custom domain)

Use this route if you have Netlify and Render accounts but do not own a domain.
Netlify and Render provide HTTPS subdomains. Check the current plan limits
before deploying and choose a Supabase plan appropriate for the data you intend
to retain.

### 1. Deploy the frontend to Netlify

1. Push the repository to a Git provider accessible to Netlify.
2. In Netlify, create a site by importing that repository.
3. Use the repository root as the base directory. Leave the build command
   empty and publish `frontend`. These settings are also in `netlify.toml`.
4. Deploy the site and copy its primary HTTPS URL, for example
   `https://your-site-name.netlify.app`.

At this stage the frontend is in standalone mode. Do not enter the browser
demo's `admin@...` / `grace` credentials expecting them to authenticate against
the API.

### 2. Create a Supabase project

1. Create a project in Supabase and choose a region close to the Render API.
2. In the Supabase project's **Connect** dialog, select the **Session pooler**
   and copy its PostgreSQL connection string. Ensure it includes
   `sslmode=require`; keep it private.
3. The API migration creates the application tables in this new project. It
   does not copy records from a previous database.

### 3. Deploy the API on Render

1. Create a Render **Web Service** from the same repository.
2. Set the runtime to **Docker**, the root directory to `backend`, and select
   a region close to the Supabase project.
3. Set the health check path to `/api/health`.
4. Add these environment variables in the Render service settings:

   | Key | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `SUPABASE_DB_URL` | The Supabase Session pooler PostgreSQL connection string from step 2. |
   | `SUPABASE_URL` | The Supabase project URL, e.g. `https://<project-ref>.supabase.co`. |
   | `SUPABASE_ANON_KEY` | The project's publishable/anon key. Never use the service-role key. |
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
exist in Supabase. The app currently has no public admin-creation
screen; provision an authorized test administrator through a secure database
administration process before testing the admin console. Never make a public
bootstrap endpoint or expose database credentials to the browser.

When `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set, API sign-in verifies
passwords with Supabase Auth. The app still keeps roles and campus access in
its own `public.users` table. A verified Supabase account can be linked to an
existing app user by email; otherwise, set trusted Supabase `app_metadata`
fields `church_role` and (for non-HQ users) `church_branch_id` before signing
in. Valid roles are `hq_admin`, `branch_admin`, `ministry_leader`, and `member`;
campus values must match this app's `branches.id`. The API ignores
user-editable `user_metadata` for authorization. New accounts with valid
trusted metadata are added to the app table at first sign-in. Account signup
through this API is disabled when Supabase Auth is enabled.

### 4. Connect Netlify to the Render API

After the API URL is available:

1. Set `CORS_ORIGINS` in Render to the public Netlify site origin
   (`https://cmdcms.netlify.app`, without a trailing slash), then redeploy or
   restart the API if you changed it. The API also includes that production
   Netlify origin in its CORS allowlist.
2. The deployed frontend uses the production API origin configured in
   `frontend/js/config.js`; localStorage overrides still take precedence.
3. Open the Netlify site and test the login with the administrator account
   provisioned in Supabase. The API's demo MFA verifier expects the
   `MFA_DEMO_CODE` value.

If a Netlify deploy-preview URL is used for testing, add that exact origin to
`CORS_ORIGINS` as an additional comma-separated value. Keep the list limited
to origins you control.

### 5. Testing limitations

- Render Free web services may take about a minute to wake after inactivity.
- Back up Supabase data according to the retention needs of your project.
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
- Supabase project with a Session pooler connection string.
- Contabo VPS (Ubuntu 22.04/24.04) with Docker + Docker Compose installed:
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```
- The Vercel CLI locally (`npm i -g vercel`) or the Vercel dashboard.

---

## Part A — Backend on Contabo

1. **Copy the repository to the VPS** (clone the repo, including `backend/` and `deploy/`).

2. **Configure secrets**:
   ```bash
   cd deploy
   cp .env.example .env
   # Edit .env:
   #   SUPABASE_DB_URL — the private connection string from Supabase
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
   The API container runs migrations against Supabase automatically on start.

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
   (Or import the GitHub repo in the Vercel dashboard — `vercel.json` publishes `frontend/` and `.vercelignore` excludes `backend/` and `deploy/`.)

2. **Connect the frontend to the API.** Set the API base URL in `frontend/js/config.js`:
   ```js
   window.CHURCH2_CONFIG = { apiBase: "https://api.yourchurch.org" };
   ```
   Commit + redeploy. (For a quick test without editing the file, open the app and run
   `localStorage.setItem('church2_api_base','https://api.yourchurch.org')` in the console, then reload.)

3. **Lock CORS down**: ensure `CORS_ORIGINS` in the Contabo `.env` is exactly your Vercel production URL, then `docker compose up -d` to apply.

---

## Verify the whole path

Open the Vercel URL and sign in with the HQ administrator provisioned for the API, using the configured MFA code.
You should see real data served from Supabase PostgreSQL. A wrong password is rejected by the server; a branch admin only ever sees their own campus.

---

## Security checklist before real launch

- [ ] Provision real staff accounts; the API does not create demo accounts or sample records.
- [ ] Swap the mock MFA (`MFA_DEMO_CODE`) for real TOTP (the `/auth/mfa` step is structured for this).
- [ ] Strong, unique `JWT_SECRET`; keep `SUPABASE_DB_URL` private and never commit `.env`.
- [ ] `CORS_ORIGINS` restricted to your exact frontend origin (no `*`).
- [ ] Configure and verify Supabase database backups for the project's retention needs.
- [ ] Add real payment processing (Stripe/Tithe.ly) for live giving — currently receipts are recorded, not charged.

---

## What's wired vs. remaining

**Done & verified:** real auth (bcrypt + JWT + MFA step), RBAC + server-side campus scoping, and REST endpoints for members, transactions/giving, attendance, dashboard summary, groups, follow-ups, announcements, prayer requests, and events. When an `apiBase` is configured the whole UI is **backend-backed**: on login the app hydrates `this.db` from Supabase PostgreSQL (so every view renders shared, real data), and every mutation — recording a gift, marking attendance, enrolling a member, moving a follow-up, creating/joining a group, sending a broadcast, submitting/dismissing a prayer request — is mirrored to the API and persisted. Writes are optimistic (the UI updates instantly) and reconcile the server-assigned id; a failed sync surfaces a toast rather than silently dropping. With no `apiBase` set the same code runs standalone against localStorage (demo mode). All paths were verified end-to-end against a live PostgreSQL database, including that a branch admin cannot read or write outside their own campus even by tampering with `?branch=`.

**Remaining increment:** add live payment processing so giving is charged, not just recorded. For this client that means an **M-Pesa Daraja** integration (STK push + C2B confirmation callback) against the church's own paybill, with a card fallback. A few client-only conveniences without server endpoints yet — recurring-gift schedules, scripture reading streaks, and event volunteer sign-ups — remain local until matching endpoints are added; everything else is backend-backed.

---

## Client configuration (Christian Mission Dunamis)

Everything client-specific lives in **two places**, by design:

| What | Where |
|---|---|
| Church name, tagline, website, currency, campuses, ministries, service times, M-Pesa paybill, card fee rates | `frontend/js/brand.js` |
| Brand palette (`--mmc-royal`, `--mmc-royal-light`, `--mmc-gold`, `--mmc-gold-deep`) | top of `frontend/styles.css` `:root` |

To rebrand for another church, change those two files — no other file hardcodes the client's identity, colours or currency. The palette hex values are mirrored in `frontend/js/brand.js` under `palette` so charts (canvas-drawn, can't read CSS) stay in sync.

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

- [ ] **M-Pesa paybill / account number.** `frontend/js/brand.js` ships `paybill: '891300'` with `shortCodeConfirmed: false` — a placeholder. Replace it with the church's real short code and flip the flag. **Until that flag is `true` the giving screen deliberately shows no number at all**, just a "not live yet, give in person or by bank transfer" notice — a plausible-but-wrong paybill is how a member's tithe reaches a stranger's account.
- [ ] **Exact brand hex codes** and a vector logo, if the church's designer has them. The current royal-and-gold palette was set from public brand material.
- [ ] **Campus addresses and service times** in `frontend/js/brand.js` (`campuses`, `services`).
- [ ] **Real staff accounts** — provision staff accounts for the live API; it has no seeded demo logins.
