"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useState } from "react";

import { auth } from "@/lib/firebase";

// The welcome page is the usual entry point, so it must not keep offering
// "sign in" to somebody whose Firebase session is still active.
export default function LandingActions() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setSignedIn(Boolean(user));
    });

    return unsubscribe;
  }, []);

  if (signedIn) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/dashboard"
          className="inline-flex min-h-12 items-center justify-center gap-4 rounded-xl bg-[#d6b56d] px-5 text-xs font-bold text-[#064e3b] transition hover:bg-[#e6c477]"
        >
          Continue to your dashboard
          <ArrowRight size={18} />
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Link
        href="/signup"
        className="inline-flex min-h-12 items-center justify-center gap-4 rounded-xl bg-[#d6b56d] px-5 text-xs font-bold text-[#064e3b] transition hover:bg-[#e6c477]"
      >
        Create your account
        <ArrowRight size={18} />
      </Link>

      <Link
        href="/login"
        className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/25 px-5 text-xs font-bold text-white transition hover:bg-white/10"
      >
        I already have an account
      </Link>
    </div>
  );
}
