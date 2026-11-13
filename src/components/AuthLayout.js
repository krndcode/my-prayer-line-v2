
"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";

import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";

export default function AuthLayout({ mode }) {
  const isSignup = mode === "signup";
  const router = useRouter();

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  function getFriendlyError(error) {
    const errors = {
      "auth/email-already-in-use":
        "An account with this email already exists. Please sign in instead.",

      "auth/invalid-email":
        "Please enter a valid email address.",

      "auth/weak-password":
        "Your password is too weak. Please use a stronger password.",

      "auth/user-not-found":
        "No account was found with this email address.",

      "auth/wrong-password":
        "Incorrect password. Please try again.",

      "auth/invalid-credential":
        "Your email or password is incorrect.",

      "auth/too-many-requests":
        "Too many attempts. Please wait a moment and try again.",

      "auth/network-request-failed":
        "Network connection failed. Please check your internet connection.",

      "auth/operation-not-allowed":
        "This sign-in method is not enabled in Firebase.",

      "auth/popup-closed-by-user":
        "Google sign-in was cancelled.",

      "auth/popup-blocked":
        "Your browser blocked the Google sign-in window. Please allow popups.",

      "auth/unauthorized-domain":
        "This website domain is not authorized in Firebase.",

      "auth/account-exists-with-different-credential":
        "An account already exists with this email using another sign-in method.",
    };

    return errors[error.code] || "Something went wrong. Please try again.";
  }

  // EMAIL AND PASSWORD AUTHENTICATION
  async function handleSubmit(event) {
    event.preventDefault();

    setMessage("");

    const form = event.currentTarget;
    const data = new FormData(form);

    const email = data.get("email")?.toString().trim().toLowerCase();
    const password = data.get("password")?.toString();
    const fullName = data.get("fullName")?.toString().trim();
    const phone = data.get("phone")?.toString().trim() || "";

    if (isSignup && password !== data.get("confirmPassword")) {
      setMessage("Your passwords do not match.");
      return;
    }

    if (isSignup && !fullName) {
      setMessage("Please enter your full name.");
      return;
    }

    setIsLoading(true);

    try {
      if (isSignup) {
        // Create Firebase Authentication account.
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );

        const user = userCredential.user;

        // Update Firebase profile.
        await updateProfile(user, {
          displayName: fullName,
        });

        // Create Firestore user profile.
        await setDoc(doc(db, "users", user.uid), {
          uid: user.uid,
          displayName: fullName,
          email: user.email,
          phoneNumber: phone,
          photoURL: null,
          role: "member",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

      } else {
        // Sign in existing user.
        await signInWithEmailAndPassword(
          auth,
          email,
          password
        );
      }

      router.replace("/dashboard");
      router.refresh();

    } catch (error) {
      console.error("Email authentication error:", error);
      setMessage(getFriendlyError(error));

    } finally {
      setIsLoading(false);
    }
  }

  // GOOGLE AUTHENTICATION
  async function handleGoogleSignIn() {
    setMessage("");
    setIsLoading(true);

    try {
      const provider = new GoogleAuthProvider();

      provider.setCustomParameters({
        prompt: "select_account",
      });

      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Check whether the Firestore profile already exists.
      const userRef = doc(db, "users", user.uid);
      const userSnapshot = await getDoc(userRef);

      // Create a profile for a new Google user.
      if (!userSnapshot.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          displayName: user.displayName || "",
          email: user.email || "",
          phoneNumber: user.phoneNumber || "",
          photoURL: user.photoURL || null,
          role: "member",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      router.replace("/dashboard");
      router.refresh();

    } catch (error) {
      console.error("Google authentication error:", error);
      setMessage(getFriendlyError(error));

    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid grid-cols-1 lg:grid-cols-[42%_58%] bg-white">

      {/* IMAGE PANEL */}
      <aside className="relative hidden lg:block m-4 overflow-hidden rounded-2xl min-h-[calc(100vh-2rem)]">
        <Image
          src="/auth-hero.jpg"
          alt="A peaceful moment of prayer and reflection"
          fill
          priority
          sizes="42vw"
          className="object-cover"
        />

        <div className="absolute inset-0 bg-gradient-to-t from-[#03241b]/95 via-[#03241b]/20 to-transparent" />

        <Link href="/" className="absolute top-7 left-7 text-white">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-white">
              <Image
                src="/mpl-logo.png"
                alt="My Prayer Line logo"
                width={40}
                height={40}
                className="h-full w-full object-contain"
              />
            </span>

            <span>
              <strong className="block font-bold">My Prayer Line</strong>
              <small className="text-white/70 text-xs">
                Connecting hearts through prayer
              </small>
            </span>
          </div>
        </Link>

        <blockquote className="absolute bottom-12 left-9 right-9 text-white font-semibold text-xl leading-relaxed">
          “When we pray and there isn&apos;t no answer, there would be no need for prayers”

          <span className="block text-[#d9c184] text-xs font-normal mt-4">
            — RICHARD NYAME DADZIE, Founder of My Prayer Line
          </span>
        </blockquote>
      </aside>

      {/* FORM PANEL */}
      <section className="relative flex items-center justify-center px-6 py-16 sm:px-12">

        <Link
          href="/"
          className="absolute top-7 left-6 sm:left-10 flex items-center gap-2 text-sm text-gray-500 hover:text-[#059669]"
        >
          <ArrowLeft size={17} />
          Back
        </Link>

        <div className="w-full max-w-[420px]">

          {/* MOBILE LOGO */}
          <div className="lg:hidden mb-12">
            <Link href="/" className="flex items-center gap-3 text-[#064e3b]">
              <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-white">
                <Image
                  src="/mpl-logo.png"
                  alt="My Prayer Line logo"
                  width={40}
                  height={40}
                  className="h-full w-full object-contain"
                />
              </span>

              <span>
                <strong className="block">My Prayer Line</strong>
                <small className="text-gray-500 text-xs">
                  Connecting hearts through prayer
                </small>
              </span>
            </Link>
          </div>

          <span className="text-[#059669] text-xs font-bold tracking-[0.18em]">
            {isSignup ? "WELCOME TO THE COMMUNITY" : "WELCOME BACK"}
          </span>

          <h1 className="font-bold text-3xl text-[#1f2937] mt-3 mb-2">
            {isSignup ? "Create your account" : "Continue your journey."}
          </h1>

          <p className="text-sm text-gray-500 mb-8">
            {isSignup
              ? "Join believers around the world in prayer."
              : "Sign in to reconnect with your prayer community."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* SIGNUP FIELDS */}
            {isSignup && (
              <>
                <label className="block text-sm font-semibold text-gray-700">
                  Full name

                  <input
                    name="fullName"
                    type="text"
                    required
                    placeholder="Your full name"
                    className="auth-input"
                  />
                </label>

                <label className="block text-sm font-semibold text-gray-700">
                  Phone number

                  <input
                    name="phone"
                    type="tel"
                    placeholder="+233 00 000 0000"
                    className="auth-input"
                  />
                </label>
              </>
            )}

            {/* EMAIL */}
            <label className="block text-sm font-semibold text-gray-700">
              Email address

              <input
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                className="auth-input"
              />
            </label>

            {/* PASSWORD */}
            <label className="block text-sm font-semibold text-gray-700">
              Password

              <div className="relative">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                  className="auth-input pr-12"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            {/* CONFIRM PASSWORD */}
            {isSignup && (
              <label className="block text-sm font-semibold text-gray-700">
                Confirm password

                <div className="relative">
                  <input
                    name="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    minLength={8}
                    placeholder="Repeat your password"
                    className="auth-input pr-12"
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setShowConfirmPassword(!showConfirmPassword)
                    }
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"
                    aria-label="Toggle confirm password visibility"
                  >
                    {showConfirmPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>
              </label>
            )}

            {/* TERMS OR REMEMBER ME */}
            <div className="flex items-center justify-between gap-3 text-xs text-gray-500">
              {isSignup ? (
                <label className="flex items-center gap-2">
                  <input type="checkbox" required />
                  I agree to the Terms & Privacy Policy
                </label>
              ) : (
                <>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="remember" />
                    Remember me
                  </label>

                  <Link
                    href="/forgot-password"
                    className="text-[#059669] font-semibold"
                  >
                    Forgot password?
                  </Link>
                </>
              )}
            </div>

            {/* ERROR MESSAGE */}
            {message && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700"
              >
                {message}
              </p>
            )}

            {/* SUBMIT */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-xl bg-[#064e3b] hover:bg-[#059669] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3.5 transition"
            >
              {isLoading
                ? "Please wait..."
                : isSignup
                  ? "Create account"
                  : "Sign in"}
            </button>

            {/* DIVIDER */}
            <div className="flex items-center gap-4 py-2">
              <span className="h-px flex-1 bg-gray-200" />
              <span className="text-xs text-gray-400">
                or continue with
              </span>
              <span className="h-px flex-1 bg-gray-200" />
            </div>

            {/* GOOGLE SIGN IN */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="w-full rounded-xl border border-gray-200 py-3 font-semibold text-sm hover:bg-gray-50 disabled:opacity-60"
            >
              <span className="text-blue-600 font-bold mr-2">G</span>
              {isLoading ? "Please wait..." : "Continue with Google"}
            </button>

          </form>

          {/* SWITCH LOGIN / SIGNUP */}
          <p className="text-center text-sm text-gray-500 mt-7">
            {isSignup
              ? "Already have an account?"
              : "New to My Prayer Line?"}{" "}

            <Link
              href={isSignup ? "/login" : "/signup"}
              className="text-[#059669] font-bold"
            >
              {isSignup ? "Sign in" : "Create an account"}
            </Link>
          </p>

        </div>
      </section>

      {/* INPUT STYLES */}
      <style jsx global>{`
        .auth-input {
          display: block;
          width: 100%;
          margin-top: 7px;
          padding: 13px 14px;
          border: 1px solid #e8e9e5;
          border-radius: 10px;
          outline: none;
          font-size: 14px;
          font-weight: 400;
          color: #1f2937;
          background: white;
        }

        .auth-input:focus {
          border-color: #059669;
          box-shadow: 0 0 0 3px rgba(5, 150, 105, 0.1);
        }
      `}</style>

    </main>
  );
}
