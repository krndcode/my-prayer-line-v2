import Link from "next/link";
import { HandHeart } from "lucide-react";
import AppShell from "@/components/AppShell";

export default function DonatePage() {
  return (
    <AppShell title="Support this app">
      <main className="mx-auto w-full max-w-[760px] px-5 pb-24 pt-10 sm:px-8 lg:px-12 lg:pt-14">
        <section className="rounded-3xl border border-[#e8e9e5] bg-white p-7 shadow-sm sm:p-10">
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eaf5f0] text-[#064e3b]">
            <HandHeart size={28} strokeWidth={1.8} />
          </div>
          <p className="mb-2 text-[10px] font-bold tracking-[0.18em] text-[#87918c]">
            KEEPING THE COMMUNITY FREE
          </p>
          <h1 className="font-[Manrope] text-2xl font-bold tracking-tight text-[#172720] sm:text-3xl">
            Support My Prayer Line
          </h1>
          <p className="mt-4 text-sm leading-7 text-[#69736f]">
            My Prayer Line will always be free to use. Contributions will help
            cover hosting and support the development of future features.
          </p>

          <div
            role="status"
            className="mt-7 rounded-2xl border border-[#eadfbd] bg-[#fbf7eb] p-4 text-sm leading-6 text-[#725c2d]"
          >
            Secure donations are not set up yet. We will add a payment option
            here when it is ready.
          </div>

          <Link
            href="/contact-support"
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-bold text-white transition hover:bg-emerald-700"
            style={{ color: "#fff" }}
          >
            Contact support
          </Link>
        </section>
      </main>
    </AppShell>
  );
}
