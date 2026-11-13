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

- Browser-based **peer-to-peer audio/video calls** using WebRTC, with Firestore used for signaling and Google STUN servers for connectivity.

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
| Calls | WebRTC (peer-to-peer mesh) with Firestore signaling |
| Testing | Node.js test runner + `@firebase/rules-unit-testing` |
| Linting | ESLint 9 with `eslint-config-next` |

---

## Getting started

### Prerequisites

- **Node.js 20+** (Node 22 LTS recommended)
- **npm** (a `package-lock.json` is committed)
- A **Firebase project** with Authentication and Firestore enabled
- Optional, for rules tests: **Java 21+** and the **Firebase CLI**

### 1. Clone and install

```bash
git clone https://github.com/krndcode/my-prayer-line-v2.git
cd my-prayer-line-v2
npm install
```

### 2. Configure environment variables

Copy the variable names below into a new `.env.local` file at the project root and fill in the values from your Firebase project settings. See [Environment variables](#environment-variables).

### 3. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment variables

Create `.env.local` in the project root:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=
```

These are read in `src/lib/firebase.js` and are the standard Firebase web app configuration values. They are safe to expose in the browser; access is controlled by Firebase Security Rules, not by hiding the config.

> `.env*` files are git-ignored and never committed.

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
| `prayerGroups/{groupId}/calls/{callId}` | Call signaling (`participants`, `signals`) |
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
│   │   ├── notifications/   # Activity feed
│   │   ├── profile/         # Account and profile settings
│   │   ├── donate/          # Informational support page
│   │   ├── contact-support/ # Support form
│   │   ├── login/ signup/ forgot-password/
│   │   └── layout.js        # Root layout and theme provider
│   ├── components/          # App shell, sidebar, auth layout, calls, providers
│   └── lib/                 # Firebase init, notifications, sharing, theming, helpers
├── tests/                   # Firestore/Storage rules tests
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
| `npm run test:rules` | Run Firestore/Storage rules tests in the emulators |

---

## Testing

Rules tests use the Firebase Emulator Suite and run against a demo project, so they never touch a live Firebase project:

```bash
npm run test:rules
```

Requirements: **Java 21+**, the **Firebase CLI**, and both `firestore.rules` and `storage.rules` present in the project root.

The suite covers notification spoofing, group membership access, report workflows, admin activity logging, image URL validation, and denied Storage writes.

---

## Deployment

This is a standard Next.js app and deploys well to [Vercel](https://vercel.com/new):

1. Import the repository in Vercel.
2. Add the `NEXT_PUBLIC_FIREBASE_*` environment variables from `.env.local`.
3. Deploy, then add the production domain to Firebase **Authentication → Authorized domains**.

Firebase Hosting is also possible with the included `firebase.json`, but the app is built for a Node/Next.js host.

---

## Current limitations

- **Donations** are informational only; no payment provider is connected yet.
- **File uploads and chat attachments** are disabled in the UI and blocked by Storage rules until storage is enabled.
- **Localization** — translation strings exist for English, French, Spanish, and Portuguese, but the language provider is not yet wired into the UI, so the interface is English.
- **Group calls** use a peer-to-peer WebRTC mesh; quality degrades as more participants join.
- Chat message "likes" are local-only and not persisted.

---

## Contributing

Issues and pull requests are welcome. Please run `npm run lint` before opening a PR, and keep Firebase rules changes mirrored in your local rules files (they are not tracked here).

## License

No license has been specified for this project. All rights reserved by the author unless a license is added.
