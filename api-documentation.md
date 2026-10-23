# Church 2.0 API

The backend is an Express API backed by PostgreSQL. All routes use the `/api` prefix. The API listens on port `4000` by default; configure `PORT`, database settings, and allowed production origins in the server environment.

## Authentication

Except for `GET /health` and the authentication endpoints, requests require a bearer token:

```http
Authorization: Bearer <token>
```

### `POST /auth/signup`

Creates a member account and linked member profile. Public registration can only assign the `member` role.

```json
{
  "email": "member@example.org",
  "password": "a-password-of-at-least-12-characters",
  "firstName": "Ama",
  "lastName": "Mensah",
  "phone": "+233200000000",
  "branchId": "b1"
}
```

### `POST /auth/login`

Accepts `{ "email": "...", "password": "..." }`. Returns a token and user when MFA is disabled, or `{ "mfaRequired": true, "ticket": "..." }` when it is enabled.

### `POST /auth/mfa`

Accepts `{ "ticket": "...", "code": "..." }` and returns `{ "token": "...", "user": {...} }`. The current MFA verifier is a development/demo code, not a production TOTP or SMS provider. Do not treat it as production-ready MFA.

### `GET /auth/me`

Returns the authenticated user identity.

## Campus scope and roles

- HQ administrators can access all campuses or select one with `?branch=b1`; `?branch=global` requests all campuses.
- Branch administrators and ministry leaders are locked to their assigned campus. A `branch` query or body value cannot grant access to another campus.
- Members are restricted to their linked profile and campus.
- Only HQ administrators can assign the `branch_admin` role.

The canonical campus IDs provisioned by the schema are `b1` (Accra Main), `b2` (Kumasi Branch), and `b3` (Takoradi Branch).

## Routes

| Method | Route | Access | Behavior |
|---|---|---|---|
| `GET` | `/health` | Public | Reports API and PostgreSQL health. |
| `GET` | `/members` | Authenticated | Lists members in permitted scope; optional `search` parameter. Members only receive their own record. |
| `GET` | `/members/:id` | Authenticated | Returns a scoped member profile. |
| `PATCH` | `/members/:id/milestones` | HQ/branch admin | Replaces the member's spiritual milestone list (up to 100 entries) in permitted scope. |
| `POST` | `/members` | HQ/branch admin | Creates a member, optional campus group assignments, and optional login account in one transaction. |
| `POST` | `/members/import` | HQ/branch admin | Imports 1–500 validated member records at a time, returning created records and row-level validation errors. |
| `DELETE` | `/members/:id` | HQ/branch admin | Removes the member, linked login, attendance, and group assignments; financial records remain. |
| `GET` | `/transactions` | Authenticated | Lists transactions in scope; members only see their own. |
| `POST` | `/transactions` | Authenticated | Records a valid contribution. Members may record only their own contributions. |
| `DELETE` | `/transactions/:id` | HQ/branch admin | Permanently removes a transaction in permitted scope. |
| `GET` | `/collection-sessions` | HQ/branch admin | Lists saved collection sessions in scope. |
| `POST` | `/collection-sessions` | HQ/branch admin | Records offering, tithe, and other amounts; total is calculated by PostgreSQL. |
| `DELETE` | `/collection-sessions/:id` | HQ/branch admin | Permanently removes a collection session in permitted scope. |
| `GET` | `/attendance` | Authenticated | Lists individual check-ins in scope; members only see their own. |
| `PUT` | `/attendance` | HQ/branch admin/ministry leader | Creates or updates a member check-in. Requires a valid `YYYY-MM-DD` date and boolean `present`. |
| `DELETE` | `/attendance/:memberId/:date` | HQ/branch admin/ministry leader | Removes a member check-in in permitted scope. |
| `GET` | `/attendance/headcounts` | HQ/branch admin/ministry leader | Lists service headcounts in scope. |
| `PUT` | `/attendance/headcount` | HQ/branch admin | Creates or updates a total for a campus and service date. |
| `DELETE` | `/attendance/headcounts/:id` | HQ/branch admin | Permanently removes a service headcount in permitted scope. |
| `GET` | `/dashboard/summary` | Authenticated | Returns summary metrics calculated from persisted records. |
| `GET` | `/groups` | Authenticated | Lists groups in scope. |
| `POST` | `/groups` | HQ/branch admin/ministry leader | Creates a campus group. |
| `DELETE` | `/groups/:id` | HQ/branch admin/ministry leader | Removes a group in permitted scope. |
| `DELETE` | `/groups/:id/members/:memberId` | HQ/branch admin/ministry leader | Removes a member's group assignment without deleting their profile. |
| `POST` | `/groups/:id/toggle-member` | Authenticated | Adds/removes a same-campus member; a member account can only change its own assignment. |
| `GET` | `/followups` | Authenticated | Lists guest follow-ups in scope. |
| `POST` | `/followups` | HQ/branch admin/ministry leader | Adds a guest to the follow-up pipeline. |
| `PATCH` | `/followups/:id` | HQ/branch admin/ministry leader | Moves a guest through `New Guest`, `Contacted`, `Connected`, or `Member`. |
| `DELETE` | `/followups/:id` | HQ/branch admin/ministry leader | Removes a guest follow-up in permitted scope. |
| `GET` | `/announcements` | Authenticated | Lists global and applicable campus announcements. |
| `POST` | `/announcements` | HQ/branch admin | Stores a broadcast record and calculates recipients. Branch admins are restricted to their campus. |
| `DELETE` | `/announcements/:id` | HQ/branch admin | Removes a permitted broadcast record from history; it cannot recall messages already sent. |
| `GET` | `/prayer-requests` | Authenticated | Lists requests in scope; members only see their own requests. |
| `POST` | `/prayer-requests` | Authenticated | Saves a request using the member's verified identity and campus when linked. |
| `DELETE` | `/prayer-requests/:id` | HQ/branch admin/ministry leader | Removes a request in permitted scope. |
| `GET` | `/events` | Authenticated | Lists events in scope. |
| `POST` | `/events` | HQ/branch admin/ministry leader | Creates a dated event with optional description, time, and unique volunteer roles. |
| `PATCH` | `/events/:id` | HQ/branch admin/ministry leader | Updates event details and volunteer roles in permitted scope. |
| `DELETE` | `/events/:id` | HQ/branch admin/ministry leader | Removes an event in permitted scope. |
| `DELETE` | `/events/:id/volunteer/:memberId` | HQ/branch admin/ministry leader | Removes a member's volunteer assignment from an event in permitted scope. |
| `POST` | `/events/:id/rsvp` | Authenticated | Registers the linked member or an authorized same-campus member for an event. |
| `POST` | `/events/:id/volunteer` | Authenticated | Adds the member to an event's listed volunteer role and signup list. |
| `GET` | `/campaigns` | HQ/branch admin | Lists global and campus campaigns in permitted scope. |
| `POST` | `/campaigns` | HQ/branch admin | Creates a campaign with a goal, raised offset, fund category, and optional campus. |
| `PATCH` | `/campaigns/:id` | HQ/branch admin | Updates campaign details in permitted scope. |
| `DELETE` | `/campaigns/:id` | HQ/branch admin | Removes a campaign in permitted scope. |
| `GET` | `/recurring-gifts` | HQ/branch admin | Lists recurring giving schedules in permitted scope. |
| `POST` | `/recurring-gifts` | HQ/branch admin | Creates a schedule for a campus member or named donor. |
| `PATCH` | `/recurring-gifts/:id` | HQ/branch admin | Updates amount, donor, cadence, payment method, next date, or active state. |
| `DELETE` | `/recurring-gifts/:id` | HQ/branch admin | Removes a recurring giving schedule in permitted scope. |

## Examples

### Create a member with a group and optional system account

Omit `account` when the person does not need to sign in. When creating an account, provide a valid email and a temporary password with at least 12 characters.

```json
{
  "firstName": "Ama",
  "lastName": "Mensah",
  "email": "ama@example.org",
  "phone": "+233200000000",
  "branchId": "b1",
  "groupIds": ["g_abc123"],
  "account": {
    "role": "ministry_leader",
    "password": "temporary-password-12"
  }
}
```

Supported account roles: `member`, `ministry_leader`, and `branch_admin`. Only HQ administrators can grant `branch_admin`.

### Import members from CSV

`POST /members/import` accepts `branchId` and a `members` array of up to 500 records with `firstName`, `lastName`, optional `email`, `phone`, `volunteer_skills`, same-campus `groupIds`, `maritalStatus`, `background`, and `expectations`. The request body limit is 8 MB for this endpoint. The server enforces the caller's campus scope, skips duplicate email addresses at that campus, and returns created members plus row-level errors. CSV imports do not create login accounts.

The directory's downloadable CSV template includes a `groups` column; put exact campus group names there, separated by semicolons. Group names are matched without regard to case and must be unique at the selected campus. Login accounts and system roles are not created by CSV import.

### Create an event

`POST /events` accepts a title, required service date, optional 24-hour `time`, description, and unique `rolesRequired` list. Branch scope is enforced by the server. Event updates use `PATCH /events/:id`.

### Create a campaign

`POST /campaigns` accepts `name`, optional non-negative `goal` and `raisedOffset`, optional `fundCategory`, and an optional `branchId`. HQ-created campaigns without a campus are global. Branch administrators can only create campaigns for their own campus.

### Create a recurring gift schedule

`POST /recurring-gifts` accepts either a same-campus `memberId` or `memberName`, a positive `amount`, `frequency` (`weekly`, `biweekly`, `monthly`, `quarterly`, or `annually`), and optional `category`, `method`, `nextDate`, and `active` fields.

### Record a daily collection

`POST /collection-sessions` accepts `sessionName`, `date`, `branchId`, `offeringAmount`, `titheAmount`, and `otherAmount`. Amounts must be non-negative, have at most two decimal places, and sum to more than zero.

### Record total attendance

`PUT /attendance/headcount` accepts:

```json
{
  "date": "2026-10-18",
  "branchId": "b1",
  "totalPresent": 150
}
```

Saving the same campus and date again updates that total.

## Current integration boundaries

- Announcement endpoints persist broadcast records and recipient counts. They do not yet deliver SMS, email, or push messages; provider integrations must be configured before describing a message as sent.
- Announcement endpoints persist broadcast records and recipient counts. They do not deliver SMS, email, or push messages; provider integrations must be configured before describing a message as sent.
