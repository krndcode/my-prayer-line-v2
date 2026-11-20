import "server-only";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// Stable, non-secret reasons. Never include an env value, email, or key here.
export class FirebaseAdminConfigError extends Error {
  constructor(reason) {
    super(`Firebase Admin configuration error: ${reason}`);
    this.name = "FirebaseAdminConfigError";
    this.reason = reason;
  }
}

function env(name) {
  return String(process.env[name] || "").trim();
}

// One app per server process. globalThis keeps it shared across module reloads
// and warm serverless invocations, so a second Admin app is never created.
const adminCache = globalThis.__mplFirebaseAdmin || {
  app: null,
  auth: null,
  db: null,
};
globalThis.__mplFirebaseAdmin = adminCache;

export function getFirebaseAdminApp() {
  if (adminCache.app) return adminCache.app;

  // If the host already registered the default app (for example Firebase
  // App Hosting or another module in this process), reuse it as-is.
  const existing = getApps().find((app) => app.name === "[DEFAULT]");
  if (existing) {
    adminCache.app = existing;
    return existing;
  }

  // The only supported credential source is the existing service-account JSON.
  // There is deliberately no Application Default Credentials fallback: an
  // empty value must fail clearly instead of appearing to work and then failing
  // later with an unrelated error.
  const serviceAccountJson = env("FIREBASE_SERVICE_ACCOUNT");
  if (!serviceAccountJson) {
    throw new FirebaseAdminConfigError("firebase_admin_credentials_missing");
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    console.error("[firebase-admin] FIREBASE_SERVICE_ACCOUNT is not valid JSON.");
    throw new FirebaseAdminConfigError("firebase_service_account_invalid");
  }

  if (
    !serviceAccount ||
    typeof serviceAccount !== "object" ||
    Array.isArray(serviceAccount) ||
    (serviceAccount.type && serviceAccount.type !== "service_account") ||
    !serviceAccount.client_email ||
    !serviceAccount.private_key
  ) {
    console.error("[firebase-admin] FIREBASE_SERVICE_ACCOUNT is missing service-account fields.");
    throw new FirebaseAdminConfigError("firebase_service_account_incomplete");
  }

  // A single-line env value normally relies on JSON's own \n escapes, which
  // JSON.parse already converts to real newlines. Some deployment UIs store
  // the key double-escaped, leaving literal backslash-n sequences; normalize
  // only that case.
  const privateKey = String(serviceAccount.private_key);
  serviceAccount.private_key =
    privateKey.includes("\\n") && !privateKey.includes("\n")
      ? privateKey.replace(/\\n/g, "\n")
      : privateKey;

  const projectId =
    String(serviceAccount.project_id || "").trim() ||
    env("NEXT_PUBLIC_FIREBASE_PROJECT_ID") ||
    env("FIREBASE_PROJECT_ID");
  if (!projectId) {
    throw new FirebaseAdminConfigError("firebase_admin_project_id_missing");
  }

  try {
    // This is the standard service-account initialization: cert() with the
    // parsed JSON object, exactly like admin.credential.cert(serviceAccount).
    adminCache.app = initializeApp({
      credential: cert(serviceAccount),
      projectId,
    });
  } catch (error) {
    const code = typeof error?.code === "string" && /^[a-z][a-z0-9/_-]*$/i.test(error.code)
      ? error.code
      : "init_failed";
    console.error("[firebase-admin] Initialization failed:", code);
    throw new FirebaseAdminConfigError(`firebase_admin_${code}`);
  }

  return adminCache.app;
}

export function getFirebaseAdminAuth() {
  if (!adminCache.auth) adminCache.auth = getAuth(getFirebaseAdminApp());
  return adminCache.auth;
}

export function getFirebaseAdminDb() {
  if (!adminCache.db) adminCache.db = getFirestore(getFirebaseAdminApp());
  return adminCache.db;
}
