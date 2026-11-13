# Church 2.0 — Christian Mission Dunamis Ministry Console

Church 2.0 is a responsive, installable web application for coordinating church
operations across multiple campuses. It brings member records, attendance,
giving records, groups, events, follow-ups, announcements, and ministry
intelligence into one interface.

The repository separates its two connected applications:

1. **Frontend** (`frontend/`) — a static browser application that can run by
   itself in preview/demo mode.
2. **Backend** (`backend/`) — an optional REST API backed by Supabase
   PostgreSQL for authenticated, shared, persistent data.

> **Important:** A standalone preview uses sample data stored in the current
> browser. It is not a production database. The API's MFA implementation is
> currently a demo-code verifier, and giving records do not charge a payment
> method. Read [Production readiness](#production-readiness) before using this
> application with real congregational or financial data.

## Contents

- [Capabilities](#capabilities)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Run the browser preview](#run-the-browser-preview)
- [Run the API locally](#run-the-api-locally)
- [Connect the browser app to the API](#connect-the-browser-app-to-the-api)
- [Environment configuration](#environment-configuration)
- [API overview](#api-overview)
- [Roles and campus access](#roles-and-campus-access)
- [Data and persistence](#data-and-persistence)
- [Tests](#tests)
- [Deployment](#deployment)
- [Brand customization](#brand-customization)
- [Production readiness](#production-readiness)
- [Project layout](#project-layout)
- [Further documentation](#further-documentation)

## Capabilities

The available console sections and supporting tools include:

| Area | What it supports |
| --- | --- |
| Dashboard | Campus-level and cross-campus summary metrics and visualizations. |
| Member database | Search, member profiles, contact and ministry details, spiritual milestones, and CSV-based member imports. |
| Financials | Contribution records, categories, collection sessions, and campaign/recurring-gift records where enabled. These are records, not payment processing. |
| Attendance | Member check-ins, service headcounts, arrival details, and attendance summaries. |
| Ministry and rotas | Ministry/event coordination and volunteer role assignments. |
| Follow-ups | A guest-care pipeline with stages such as New Guest, Contacted, Connected, and Member. |
| Groups | Campus groups and membership assignments. |
| Communications | Announcement records and sermon repurposing tools. Announcement persistence does not itself deliver messages. |
| Ministry intelligence | Local AI-style utilities for Bible trivia, study plans, prayer-request categorization, volunteer matching, and weekly snapshots. These utilities run in the browser; they are not a hosted generative-AI service. |
| PWA support | Web app manifest, service worker, offline-cached application shell, and mobile-friendly layout. |

The client is branded for Christian Mission Dunamis. See
[Brand customization](#brand-customization) to adapt its identity and
campus-specific information.

## Architecture

```text
                         ┌──────────────────────────┐
                         │ Browser / installable PWA│
                         │ frontend/                │
                         │ index.html + app.js      │
                         └────────────┬─────────────┘
                                      │
                 ┌────────────────────┴────────────────────┐
                 │                                         │
        API not configured                         API configured
                 │                                         │
                 ▼                                         ▼
       localStorage preview                    HTTPS REST API (/api)
                                                  Express + JWT
                                                       │
                                                       ▼
                                             Supabase PostgreSQL
```

- In **preview mode**, the app runs with browser-local sample/demo state and
  does not require a database.
- In **API mode**, the browser authenticates with the API and reads/writes
  shared records in Supabase PostgreSQL. API-side authorization and campus
  scoping are enforced independently of the interface.
- The API exposes `/api/health` for service and database health checks.
- The browser assets include a local copy of Chart.js, so charts do not depend
  on a Chart.js CDN.

## Requirements

### Browser preview

- A modern browser with JavaScript and localStorage enabled.
- Node.js and npm for the included static-server command, or any static web
  server of your choice.

### API

- Node.js **20 or later** (as declared by `backend/package.json`).
- A Supabase project (the schema targets PostgreSQL 14 or later).
- npm.

### Docker deployment

- Docker Engine and Docker Compose.
- A Linux VPS, DNS for the API host, and a TLS certificate for a public
  production deployment.

## Run the browser preview

From the repository root:

```bash
npm start
```

The root package script serves only `frontend/`. Open the local URL printed by
the server in your browser. A static preview does not need the API or a
database; it uses localStorage and may show sample data.

You can also serve the `frontend/` folder with another static web server. Use a
local HTTP server rather than opening `frontend/index.html` directly if you
want service worker/PWA behavior.

> Browser preview data is local to that browser profile. It is not shared among
> staff, not backed up by the API, and should not be treated as an authoritative
> church record.

## Run the API locally

### 1. Create a Supabase project

Create a Supabase project, then copy the **Session pooler** connection string
from the project's **Connect** dialog. The server connects directly to
Supabase PostgreSQL; the connection string must include `sslmode=require`.

### 2. Configure the API environment

Copy `backend/.env.example` to `backend/.env` and fill in `SUPABASE_DB_URL` and a
unique JWT secret. Keep the connection string private and server-side.

PowerShell:

```powershell
Copy-Item backend\.env.example backend\.env
```

macOS/Linux:

```bash
cp backend/.env.example backend/.env
```

### 3. Install API dependencies and apply the schema

```bash
cd backend
npm install
npm run migrate
```

The migration applies `backend/src/db/schema.sql` to your Supabase project. It is
designed to be idempotent and creates the tables and canonical campus records;
it does **not** create demo login accounts or seed member records. This only
creates the schema; it does not copy records from any previous database.

### 4. Start the API

```bash
npm start
```

For automatic restarts during development:

```bash
npm run dev
```

The API listens on port `4000` by default. Check its health endpoint:

```text
http://localhost:4000/api/health
```

A healthy response is similar to:

```json
{"status":"ok","db":"up"}
```

To stop the API, use `Ctrl+C`. For details on deployment and TLS, see
[DEPLOY.md](./DEPLOY.md).

## Connect the browser app to the API

The browser reads its API base URL from `frontend/js/config.js`. On `localhost`
and `127.0.0.1`, it defaults to `http://localhost:4000`. On a deployed domain,
it defaults to the production API; `church2_api_base` in localStorage can
override that URL for testing.

For a quick local check, open the browser developer console and set the
following value before reloading:

```js
localStorage.setItem('church2_api_base', 'http://localhost:4000');
location.reload();
```

For a deployed frontend, configure the public API origin using the mechanism
described in [DEPLOY.md](./DEPLOY.md), then set the API's `CORS_ORIGINS` to the
exact frontend origin. The browser will call the API under `/api`; do not put
`/api` at the end of `apiBase`.

When the API is connected, sign-in can use Supabase Auth by setting
`SUPABASE_URL` and `SUPABASE_ANON_KEY` on the API. Users also need a trusted app
role/campus mapping; matching verified app accounts are linked by email, while
new accounts require trusted `app_metadata`. There is no built-in production
administrator login.

## Environment configuration

The repository has two environment templates for different deployment
contexts:

- `backend/.env.example` — direct API configuration and local development.
- `deploy/.env.example` — API configuration for the Docker Compose deployment.

Copy the relevant example to `.env`, then replace all placeholders. Never
commit a real `.env` file or expose backend secrets in browser JavaScript.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NODE_ENV` | API | Runtime mode. Use `production` in deployment. |
| `PORT` | API | API listen port; defaults to `4000`. |
| `SUPABASE_DB_URL` | API | Required Supabase Session pooler PostgreSQL connection string, including `sslmode=require`. Keep it private and server-side. |
| `SUPABASE_URL` | API | Optional Supabase project URL; enables Supabase Auth password verification when paired with `SUPABASE_ANON_KEY`. |
| `SUPABASE_ANON_KEY` | API | Optional Supabase publishable/anon key. Never use the service-role key in the frontend. |
| `JWT_SECRET` | API | Secret used to sign authentication tokens. Production requires at least 32 characters and rejects known placeholder-like values. |
| `JWT_EXPIRES_IN` | API | Token lifetime; defaults to `12h`. |
| `BCRYPT_ROUNDS` | API | Password hashing work factor; defaults to `12`. |
| `MFA_DEMO_CODE` | API | Current demo MFA verifier code. Replace the demo MFA implementation before a real production launch. |
| `CORS_ORIGINS` | API | Comma-separated list of allowed frontend origins. Required in production; use exact origins, not `*`. |

With Supabase Auth enabled, roles and campus assignments come only from the
app's database profile or trusted Supabase `app_metadata` fields
`church_role` and `church_branch_id`; user-editable metadata is not trusted.

The `deploy/.env.example` template is intended for the backend container in the
Compose deployment. Supabase hosts the database separately; Compose does not
create or persist a local database.

## API overview

All API routes use the `/api` prefix. The health endpoint and sign-in routes are
public; other endpoints require a bearer token. The API uses JSON request and
response bodies.

| Resource | Representative routes |
| --- | --- |
| Authentication | `/auth/signup`, `/auth/login`, `/auth/mfa`, `/auth/me` |
| Members | `/members`, `/members/:id`, `/members/import`, `/members/:id/milestones` |
| Giving and collections | `/transactions`, `/collection-sessions` |
| Attendance | `/attendance`, `/attendance/headcount`, `/attendance/headcounts` |
| Dashboard | `/dashboard/summary` |
| Groups | `/groups`, `/groups/:id/toggle-member` |
| Guest follow-ups | `/followups` |
| Announcements | `/announcements` |
| Prayer requests | `/prayer-requests` |
| Events | `/events`, `/events/:id/rsvp`, `/events/:id/volunteer` |
| Campaigns and recurring gifts | `/campaigns`, `/recurring-gifts` |

This list is an orientation, not the full route contract. See
[api-documentation.md](./api-documentation.md) for HTTP methods, payload
examples, access rules, validation notes, and integration boundaries.

Example health check:

```bash
curl http://localhost:4000/api/health
```

Example authenticated request (replace the placeholder with a token returned
by a successful login):

```bash
curl http://localhost:4000/api/members \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Roles and campus access

The API recognizes these roles:

- `hq_admin` — organization-wide administration; can select a campus or
  request global scope.
- `branch_admin` — administration restricted to the assigned campus.
- `ministry_leader` — ministry operations restricted to the assigned campus,
  subject to each route's role policy.
- `member` — limited to the member's own profile and permitted member actions.

Canonical campus IDs created by the schema are:

| ID | Campus |
| --- | --- |
| `b1` | Accra Main |
| `b2` | Kumasi Branch |
| `b3` | Takoradi Branch |

Campus scope is enforced by the API, not only by hiding controls in the
browser. A non-HQ user's query or request body cannot grant access to another
campus. Public signup can create only a `member` role; privileged roles must be
provisioned through an approved administrative process.

## Data and persistence

The Supabase PostgreSQL schema includes records for user accounts, campuses,
members, contributions, collection sessions, attendance, headcounts, events,
groups, follow-ups, announcements, prayer requests, campaigns, and
recurring-gift schedules.

Some important distinctions:

- The application supports a localStorage preview that is separate from API
  data. Clearing browser storage can remove preview state.
- The API migration creates schema and canonical campuses, but no sample
  accounts or demo records.
- Announcement endpoints save announcement details and calculated recipient
  counts; they do not send SMS, email, or push notifications.
- Contribution and collection endpoints record financial information; they do
  not initiate or verify a payment.
- The API includes campaign and recurring-gift records, but a recurring-gift
  record is a schedule description, not an automated payment instruction.

## Tests

Run the root project's unit tests:

```bash
npm test
```

The current test runner (`test.js`) exercises browser-side ministry
intelligence utilities, including response matching, weekly snapshot
calculations, sermon repurposing, prayer categorization, volunteer matching,
Bible trivia, study-plan generation, and scripture filtering.

These tests do not replace an API/database integration test, browser
accessibility test, or production deployment check.

## Deployment

The documented hosting routes both use Supabase PostgreSQL:

- **Testing without a custom domain:** Netlify serves the static frontend and
  Render provides the API with a provider-hosted HTTPS URL.
- **Production-style VPS deployment:** Vercel serves the static frontend and
  a VPS runs the Node API and nginx with TLS using Docker Compose from
  `deploy/`.

Read [DEPLOY.md](./DEPLOY.md) for the Supabase setup, Netlify + Render testing
setup, or for DNS, Docker Compose, certificates, frontend configuration, health
checks, and production pre-launch steps. The frontend can also run in
standalone mode when it has no API base configured.

Deployment configuration is also present in `vercel.json`, `netlify.toml`,
`.github/workflows/`, and `deploy/`. Review the chosen provider's environment,
domain, and access-protection settings before sharing a live site.

## Brand customization

Church-specific content is primarily maintained in:

- `frontend/js/brand.js` — church name, campuses, service times, ministries,
  currency, giving details, and chart palette.
- `frontend/styles.css` — CSS theme variables and visual styling.

The API seed schema provisions the three canonical campuses listed above.
Changing campus IDs or structure may require a coordinated schema and data
migration as well as frontend updates.

Do not publish an unconfirmed payment destination. The UI deliberately avoids
presenting the placeholder M-Pesa short code as live payment instructions
until it has been confirmed in the brand configuration.

## Production readiness

Before handling real member or financial information:

- Replace the demo MFA-code check with a production-grade MFA mechanism.
- Provision real staff accounts securely; do not rely on demo credentials.
- Configure a strong, unique production `JWT_SECRET`, keep `SUPABASE_DB_URL`
  private, and set exact `CORS_ORIGINS`.
- Require HTTPS for both frontend and API, protect database access, and set up
  tested database backups and restoration procedures.
- Review role permissions, privacy requirements, retention policies, and
  operational access with the church.
- Confirm campus details, service times, branding, and any giving destination
  with authorized church staff.
- Integrate a payment provider and verify payment callbacks before presenting
  a giving workflow as an online payment.
- Configure an actual delivery provider before representing announcements as
  sent messages.

This README describes the current repository and is not a security, privacy,
financial, or compliance certification.

## Project layout

```text
.
├── frontend/                  # Static site; publish this folder to Netlify/Vercel
│   ├── index.html             # Browser application shell
│   ├── app.js                 # UI state, views, interactions, local storage
│   ├── ai-engine.js           # Browser-side ministry intelligence utilities
│   ├── styles.css             # Responsive UI and theme
│   ├── js/
│   │   ├── api.js             # Browser API client
│   │   ├── brand.js           # Church-specific content and settings
│   │   └── config.js          # Browser API base configuration
│   ├── vendor/                # Locally vendored browser libraries
│   ├── sw.js                  # PWA service worker and asset cache
│   └── manifest.json          # Installable web app metadata
├── backend/                   # Express API and Supabase PostgreSQL integration
│   ├── src/
│   │   ├── index.js           # Express app, middleware, route mounting
│   │   ├── auth.js            # Authentication and authorization helpers
│   │   ├── config.js          # Validated server environment
│   │   ├── routes/            # API resource routes
│   │   └── db/                # Supabase connection pool, schema, migrations
│   ├── Dockerfile
│   └── .env.example           # Backend environment template
├── test.js                    # Root unit test runner
└── deploy/
    ├── docker-compose.yml     # API, nginx, and Certbot services
    ├── nginx/
    └── .env.example           # Compose environment template
```

## Further documentation

- [API documentation](./api-documentation.md) — routes, payloads, permissions,
  and integration boundaries.
- [Deployment runbook](./DEPLOY.md) — VPS, Docker Compose, nginx/TLS, and
  frontend deployment.
- [Software requirements specification](./srs.md) — product requirements and
  system goals.
- [Benchmark notes](./BENCHMARK.md) — project benchmark information.
