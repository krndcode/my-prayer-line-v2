"use client";

import { useState } from "react";
import Link from "next/link";
import { sendPasswordResetEmail } from "firebase/auth";
import { ArrowLeft, Mail } from "lucide-react";
import { auth } from "@/lib/firebase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    setSending(true);

    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMessage("If an account exists for that email, a password reset link has been sent.");
    } catch (firebaseError) {
      console.error("Password reset request failed:", firebaseError);
      setError(
        firebaseError.code === "auth/invalid-email"
          ? "Enter a valid email address."
          : firebaseError.code === "auth/too-many-requests"
            ? "Too many requests. Please wait a moment and try again."
            : "Unable to send a password reset email. Please try again."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fafaf7] px-5">
      <section className="w-full max-w-md rounded-3xl border border-[#e8e9e5] bg-white p-7 shadow-sm sm:p-9">
        <Link href="/login" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-[#064e3b]">
          <ArrowLeft size={16} /> Back to sign in
        </Link>
        <div className="mt-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e7f4ee] text-[#064e3b]">
          <Mail size={22} />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-[#064e3b]">Reset your password</h1>
        <p className="mt-2 text-sm leading-6 text-gray-500">
          Enter your account email and we’ll send you a password reset link.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-semibold text-gray-700">
            Email address
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#059669]"
            />
          </label>
          {error && <p role="alert" className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {message && <p role="status" className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
          <button
            type="submit"
            disabled={sending}
            className="w-full rounded-xl bg-[#064e3b] py-3.5 text-sm font-semibold text-white transition hover:bg-[#059669] disabled:opacity-60"
          >
            {sending ? "Sending..." : "Send reset link"}
          </button>
        </form>
      </section>
    </main>
  );
}
