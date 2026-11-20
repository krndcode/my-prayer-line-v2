# My Prayer Line

**Connecting hearts through prayer.**

My Prayer Line is a faith-centered community web app where believers gather in prayer groups, share what is on their heart, encourage one another, and pray together in real time. Members can create or join prayer communities, post prayer requests and testimonies in the Heat Room, chat with their group, join group audio/video calls, and stay connected through notifications.

Built with **Next.js 16 (App Router)**, **React 19**, **Tailwind CSS 4**, and **Firebase** (Authentication, Firestore, Storage).

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Firebase setup](#firebase-setup)
- [Group calls (LiveKit)](#group-calls-livekit)
- [Multi-device testing](#multi-device-testing)
- [LiveKit limits and costs](#livekit-limits-and-costs)
- [Firestore data model](#firestore-data-model)
- [Roles and permissions](#roles-and-permissions)
- [Project structure](#project-structure)
- [Scripts](#scripts)
- [Testing](#testing)
- [Deployment](#deployment)
- [Current limitations](#current-limitations)

---

## Features

### Community and prayer

- **Landing page** with sign-up and sign-in entry points.
- **Dashboard** with a daily verse, community stats, quick actions, your groups, and upcoming prayer meetings.
- **Prayer Space** — browse, search, and join public prayer groups, or create your own. Group creation goes through an approval flow with reserved-name claims and verification details.
- **Group room** (`/prayer-space/[groupId]`) — real-time group chat with replies, member list, prayer meetings, group settings, and group audio/video calls.
- **Heat Room** — a shared feed of prayer requests and testimonies. Posts can be "prayed for", shared via deep links, and opened from notifications.
- **Notifications** — real-time activity feed for group updates, report outcomes, and membership events, with unread counts in the sidebar.

### Accounts and profile

- Email/password sign-up and sign-in, **Google sign-in**, and password reset.
- Profile management, including account deletion with re-authentication.
- **Light / dark / system themes.**
- Responsive layout with a desktop sidebar and mobile navigation.

### Group calls

- **LiveKit Cloud group audio/video calls** with a WhatsApp-style, mobile-first full-screen UI.
- One independent room per prayer group, so groups never hear or see each other and there is no fixed room cap.
- The same Firebase account can join from multiple devices without kicking itself out.
- Firestore call documents are still used for **call discovery** (who is in a call and who should be notified); LiveKit carries the actual media and manages the real participant list.
- Tokens are minted only on the server after the Firebase ID token, group approval status, and active membership are verified.

### Administration

A protected admin area (`/admin`, for `platform_admin` and `super_admin` roles) covering:

| Page | Purpose |
| --- | --- |
| Overview | Platform counts and health at a glance |
| Users | Search users and manage roles |
| Groups | Review pending group approvals |
| Group management | Suspend, restore, or delete groups |
| Reports | Review and resolve group reports through a status workflow |
| Messages | Support inbox and replies |
| Administrators | Appoint or remove platform administrators |
| Activity | Real-time audit log of admin actions |
| Settings | General platform settings |

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19, Tailwind CSS 4, lucide-react icons |
| Backend | Firebase Authentication, Cloud Firestore, Cloud Storage |
| Calls | LiveKit Cloud (SFU) via `livekit-client`, `@livekit/components-react`, `livekit-server-sdk` |
| Server auth | Firebase Admin SDK verifies ID tokens and group membership before issuing LiveKit tokens |
| Testing | Node.js test runner + `@firebase/rules-unit-testing` |
| Linting | ESLint 9 with `eslint-config-next` |

---

## Getting started

### Prerequisites

- **Node.js 20+** (Node 22 LTS recommended)
- **npm** (a `package-lock.json` is committed)
- A **Firebase project** with Authentication and Firestore enabled
- A **LiveKit Cloud project** and a Firebase service account for server-side token verification (see [Group calls](#group-calls-livekit))
- Optional, for rules tests: **Java 21+** and the **Firebase CLI**

### 1. Clone and install

```bash
git clone https://github.com/krndcode/my-prayer-line-v2.git
cd my-prayer-line-v2
npm install
```

### 2. Configure environment variables

Start from the committed template:

```bash
cp .env.example .env.local
```

Fill in your Firebase web config, LiveKit Cloud credentials, and Firebase Admin credentials. See [Environment variables](#environment-variables). If the LiveKit variables are left blank, calling is disabled gracefully instead of crashing the app.

### 3. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment variables

Create `.env.local` in the project root (template: `.env.example`):

```bash
# Firebase web config — safe to expose in the browser
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=

# LiveKit Cloud — NEXT_PUBLIC_ URL is public, the key/secret are SERVER-ONLY
NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

# Firebase Admin — SERVER-ONLY; full service account JSON on one line (required for calls)
FIREBASE_SERVICE_ACCOUNT=
```

The `NEXT_PUBLIC_FIREBASE_*` values are read in `src/lib/firebase.js` and are the standard Firebase web app configuration values. They are safe to expose in the browser; access is controlled by Firebase Security Rules, not by hiding the config.

`NEXT_PUBLIC_LIVEKIT_URL` is also public (it is the WebSocket signaling URL). `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `FIREBASE_SERVICE_ACCOUNT` must **never** be prefixed with `NEXT_PUBLIC_` or committed. They are read only by server route handlers in `src/app/api/livekit/`.

> `.env*` files are git-ignored (except `.env.example`) and never committed.

---

## Firebase setup

1. Create a project in the [Firebase console](https://console.firebase.google.com/).
2. **Authentication** → enable the **Email/Password** and **Google** sign-in providers.
3. **Firestore Database** → create a database.
4. Add a Web app to the project and copy its config into `.env.local`.
5. Add your deployment domain (and `localhost`) to **Authentication → Settings → Authorized domains**.

### Security rules

The Firebase security rules (`firestore.rules` and `storage.rules`) are **intentionally not published in this repository**. They are kept local because they describe the app's access-control model in detail.

To run the rules tests or deploy rules, you need both files in the project root. `firebase.json` already points to them:

```json
{
  "firestore": { "rules": "firestore.rules" },
  "storage": { "rules": "storage.rules" }
}
```

Deploy them with:

```bash
firebase deploy --only firestore:rules,storage
```

Without the rules files, the app's behavior is unchanged, but emulator tests and rules deployment will fail.

---

## Group calls (LiveKit)

### How it works

1. A member taps the voice or video button in a group room.
2. The browser calls `POST /api/livekit/token` with the Firebase ID token.
3. The server verifies the ID token with **Firebase Admin**, checks that the group is `active` + `approved` and that the caller is an owner, active member, or platform admin, then mints a short-lived LiveKit token (15 minutes).
4. Every group gets one deterministic room, `mpl-{groupId}`. There is no shared room and no artificial 30-room cap.
5. Firestore `prayerGroups/{groupId}/calls/{callId}` documents are still written so the existing incoming-call banner and deep links keep working. LiveKit is the source of truth for who is actually connected.
6. A signed LiveKit webhook at `/api/livekit/webhook` keeps participant counts and call end state in sync.

### LiveKit Cloud setup

1. Create a project at [LiveKit Cloud](https://cloud.livekit.io).
2. Copy the **WebSocket URL** (`wss://...livekit.cloud`), **API key**, and **API secret** into `NEXT_PUBLIC_LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`.
3. In the LiveKit dashboard, add a webhook pointing to:

   ```text
   https://<your-deployment-domain>/api/livekit/webhook
   ```

   Subscribe to `room_started`, `room_finished`, `participant_joined`, and `participant_left`. The endpoint verifies the signature with your LiveKit API key/secret, so no separate webhook secret is required.

### Firebase Admin setup

The server verifies Firebase ID tokens and reads/writes Firestore with the Admin SDK. The single supported credential source is `FIREBASE_SERVICE_ACCOUNT`: paste the **full service account JSON object on one line**, with the private key's newlines escaped as `\\n`. This works identically in local Next.js development and on Vercel; no `GOOGLE_APPLICATION_CREDENTIALS` or other variable is needed.

`src/lib/firebase-admin.js` parses that JSON and initializes Firebase Admin with `cert(serviceAccount)`. It reuses an already-initialized default app when one exists, so no second Admin app is created. If `FIREBASE_SERVICE_ACCOUNT` is empty or malformed, the call routes fail immediately with a clear `server_not_configured` error — they never silently fall back to Application Default Credentials. The client email alone is not a credential; the JSON must include `type`, `project_id`, `client_email`, and `private_key`.

The service account needs the **Firebase Admin SDK Administrator Service Agent** role (or equivalent Firestore read/write plus token verification permissions). Never commit the key or expose it to the browser.

`firestore.rules` and `storage.rules` are **unchanged**. Server call writes go through the Admin SDK, which bypasses client rules; the client only writes the small `participants/{uid}` record that stops other tabs from ringing.

### User-facing errors

The call UI maps failures to plain-language messages for denied camera/microphone permissions, missing devices, expired sessions, non-members, ended calls, rate limits, network failures, and server misconfiguration. Call audio is also kept active in the background so iOS does not suspend playback.

If a call attempt returns **"Your session has expired. Please sign in again."**, check the server log before touching credentials: only a real Firebase `auth/*` rejection produces that message. A missing or unreadable Admin credential instead returns **"Calling is not available right now. Please try again later."** (`server_not_configured`) with a non-secret `reason` code in the JSON response, for example `firebase_admin_credentials_missing`, `firebase_service_account_invalid`, `firebase_service_account_incomplete`, or `missing:NEXT_PUBLIC_FIREBASE_PROJECT_ID`. All call routes reuse the single Firebase Admin app initialized in `src/lib/firebase-admin.js` (or the host's already-initialized default app) for ID-token verification and prayer-group membership checks — no second Admin app is created and no new environment variables are required. Logs contain reason codes only, never credential values. A genuinely stale cached ID token is refreshed and retried once before the sign-in message is shown.

---

## Multi-device testing

No automated test can replace a real call check. Before release, verify with at least two phones and one desktop browser:

| Check | What to confirm |
| --- | --- |
| Start voice call | Full-screen UI opens, timer runs, connection shows "Connected" |
| Join from second device | Incoming-call banner appears, deep link `?joinCall=<id>` joins automatically, both tiles appear |
| Same account, two devices | Joining on a second signed-in device does **not** kick out the first |
| Mute / unmute | State changes on both devices immediately |
| Start video / switch type | Camera turns on for everyone; switching back to voice turns it off |
| Camera switch & speaker | Front/back camera toggle and speaker selection work on mobile |
| Group isolation | A call in group A is not visible or audible in group B |
| Permissions denied | Denying mic/camera shows a clear message and does not crash |
| Session expiry | An expired/invalid token produces a "sign in again" message |
| Ended call | Joining a stale call shows "call has already ended" |
| Network drop | Airplane-mode toggle shows "Reconnecting…" and recovers |
| Mobile browsers | Test Safari on iOS and Chrome on Android, plus one desktop browser |

---

## LiveKit limits and costs

LiveKit Cloud plans (as of November 2026, verify at [livekit.com/pricing](https://livekit.com/pricing)):

| Plan | Base price | Included WebRTC participant-minutes | Overage |
| --- | --- | --- | --- |
| Build | $0/mo | 5,000/mo | Hard cap — new connections fail when exhausted |
| Ship | from $50/mo | 150,000/mo | $0.0005 per participant-minute |
| Scale | from $500/mo | 1,500,000/mo | $0.0004 per participant-minute |

Each participant counts separately, so a 10-minute call with 5 people uses 50 participant-minutes. Downstream data has its own allowance (50 GB on Build, 250 GB on Ship). Session recordings, telephony, and AI inference are separate meters and are **not** used by this app.

**These figures were not load-tested for this app.** Capacity depends on your plan, region, and actual usage. Monitor the LiveKit dashboard after launch; Build is suitable for development and small pilots, while production communities should expect at least the Ship plan.

---

## Firestore data model

| Collection | Contents |
| --- | --- |
| `users/{uid}` | Profile, role (`member`, `platform_admin`, `super_admin`), preferences |
| `users/{uid}/groupMemberships/{groupId}` | Groups the user belongs to |
| `users/{uid}/notifications/{id}` | Per-user activity notifications |
| `users/{uid}/reportStatuses/{id}` | Status-only report updates for involved users |
| `prayerGroups/{groupId}` | Group profile, public status, approval status, report status |
| `prayerGroups/{groupId}/members/{uid}` | Group membership and group-level role |
| `prayerGroups/{groupId}/messages/{id}` | Group chat messages |
| `prayerGroups/{groupId}/meetings/{id}` | Prayer meetings |
| `prayerGroups/{groupId}/calls/{callId}` | LiveKit call discovery: `roomName`, `callType`, `status`, `participantCount`, `activeParticipants`; subcollection `participants/{uid}` stops other tabs ringing |
| `communityPosts/{postId}` | Heat Room prayer requests and testimonies, including `prayedBy` |
| `groupReports/{reportId}` | Reports filed against groups |
| `groupNameClaimsV2/{name}` | Reserved group-name claims |
| `groupVerificationDetails/{groupId}` | Extra verification data for group approvals |
| `supportMessages/{messageId}` | Contact-support messages |
| `adminActivityLogs/{logId}` | Audit trail of administrator actions |
| `platformSettings/general` | Platform-wide settings |
| `appStats/community` | Aggregate community counters |

---

## Roles and permissions

| Role | Scope | Capabilities |
| --- | --- | --- |
| `member` | Platform | Create/join groups, post, chat, join calls |
| Group `admin` | One group | Manage that group's members, settings, and meetings |
| `platform_admin` | Platform | Admin area: users, groups, reports, support, activity |
| `super_admin` | Platform | Everything above, plus managing administrators |

Roles are stored on the user document and enforced by Firebase Security Rules, not only by the UI. Client-side admin routes also guard against unauthorized access.

---

## Project structure

```text
.
├── public/                  # Logo, hero images, static assets
├── src/
│   ├── app/                 # Next.js App Router routes
│   │   ├── admin/           # Admin area and its pages
│   │   ├── dashboard/       # Signed-in home
│   │   ├── prayer-space/    # Group list and group room
│   │   ├── heat-room/       # Prayer requests and testimonies feed
│   │   ├── api/livekit/      # Token, webhook, and call-management routes
│   │   ├── notifications/   # Activity feed
│   │   ├── profile/         # Account and profile settings
│   │   ├── donate/          # Informational support page
│   │   ├── contact-support/ # Support form
│   │   ├── login/ signup/ forgot-password/
│   │   └── layout.js        # Root layout and theme provider
│   ├── components/          # App shell, sidebar, auth layout, calls, providers
│   │   ├── GroupCall.jsx    # Start/join/leave controller and call discovery
│   │   └── LiveKitCall.jsx  # Full-screen LiveKit call UI (lazy-loaded)
│   └── lib/                 # Firebase init, LiveKit helpers, notifications, theming
│       ├── livekit-server.js    # Server-only Admin SDK + LiveKit room helpers
│       ├── livekit-client.js    # Browser API client and error messages
│       └── livekit-shared.js    # Pure helpers shared by client/server
├── tests/                   # LiveKit helper + Firestore/Storage rules tests
├── firebase.json            # Firebase CLI configuration
└── next.config.mjs          # Next.js configuration
```

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npm run test:unit` | Run LiveKit helper unit tests (no emulators needed) |
| `npm run test:rules` | Run Firestore/Storage rules tests in the emulators |

---

## Testing

Helper unit tests run instantly with Node's built-in test runner:

```bash
npm run test:unit
```

They cover group ID validation, room-name isolation, call-type normalization, timestamp handling, stale-call detection, and per-user rate limiting.

Rules tests use the Firebase Emulator Suite and run against a demo project, so they never touch a live Firebase project:

```bash
npm run test:rules
```

Requirements: **Java 21+**, the **Firebase CLI**, and both `firestore.rules` and `storage.rules` present in the project root.

The suite covers notification spoofing, group membership access, report workflows, admin activity logging, image URL validation, and denied Storage writes. Firestore rules were not changed by the LiveKit integration.

Always run `npm run lint` and `npm run build` before shipping; the LiveKit routes must compile in the production build.

---

## Deployment

This is a standard Next.js app and deploys well to [Vercel](https://vercel.com/new):

1. Import the repository in Vercel.
2. Add the `NEXT_PUBLIC_FIREBASE_*` environment variables from `.env.local`.
3. Add the call variables in **Project Settings → Environment Variables**:

   | Variable | Value | Exposed to browser? |
   | --- | --- | --- |
   | `NEXT_PUBLIC_LIVEKIT_URL` | `wss://<project>.livekit.cloud` | Yes (signaling URL) |
   | `LIVEKIT_API_KEY` | LiveKit Cloud API key | **No — server only** |
   | `LIVEKIT_API_SECRET` | LiveKit Cloud API secret | **No — server only** |
   | `FIREBASE_SERVICE_ACCOUNT` | Service account JSON on one line | **No — server only** |

   Do not leave `FIREBASE_SERVICE_ACCOUNT` blank — calls require it. Do not mark any of the three secret variables as visible to the client.

4. Deploy, then add the production domain to Firebase **Authentication → Authorized domains**.
5. In LiveKit Cloud, register `https://<your-domain>/api/livekit/webhook` and redeploy if you added the URL after the first deploy.

The routes run on the Node.js runtime (Next.js default). `next.config.mjs` enables `cacheComponents`, so route segment `runtime`/`dynamic` exports are intentionally omitted.

Firebase Hosting is also possible with the included `firebase.json`, but the app is built for a Node/Next.js host.

---

## Current limitations

- **Donations** are informational only; no payment provider is connected yet.
- **File uploads and chat attachments** are disabled in the UI and blocked by Storage rules until storage is enabled.
- **Localization** — translation strings exist for English, French, Spanish, and Portuguese, but the language provider is not yet wired into the UI, so the interface is English.
- **Group calls require configuration.** Without `LIVEKIT_*` and Firebase Admin credentials the call buttons are disabled with a friendly message; the rest of the app works normally.
- **Call capacity follows your LiveKit plan** and has not been load-tested here. See [LiveKit limits and costs](#livekit-limits-and-costs).
- **Rate limiting is best-effort on serverless** — the in-memory limiter is per Vercel instance, not a global quota. Use a shared store (e.g. Upstash Redis) if you need hard limits.
- **Webhooks must be registered** in the LiveKit dashboard; without them, participant counts and stale-call cleanup rely on the fallback checks in the token/call routes.
- **Audio/video state is never written to Firestore** — mute/camera state lives in LiveKit only, which avoids rule/privacy issues but means it is not persisted after reconnect.
- Chat message "likes" are local-only and not persisted.

---

## Contributing

Issues and pull requests are welcome. Please run `npm run lint` before opening a PR, and keep Firebase rules changes mirrored in your local rules files (they are not tracked here).

## License

No license has been specified for this project. All rights reserved by the author unless a license is added.
