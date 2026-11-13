
import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";

export default function WelcomePage() {
  return (
    <main className="min-h-screen bg-[#064e3b] text-white">
      <div className="grid min-h-screen lg:grid-cols-[53%_47%]">
        {/* Left content */}
        <section className="relative flex min-h-screen flex-col px-7 py-8 sm:px-12 lg:px-[15%] lg:py-[30px]">
          {/* Logo */}
          <Link href="/" className="flex w-fit items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white">
              <Image
                src="/mpl-logo.png"
                alt="My Prayer Line logo"
                width={40}
                height={40}
                className="h-full w-full object-contain"
                priority
              />
            </span>

            <span>
              <span className="block font-[Manrope] text-base font-bold tracking-tight">
                My Prayer Line
              </span>
              <span className="block text-[9px] text-white/75">
                Connecting hearts through prayer
              </span>
            </span>
          </Link>

          {/* Hero content */}
          <div className="my-auto max-w-[510px] py-20 lg:py-0">
            <p className="mb-6 text-[10px] font-bold uppercase tracking-[0.2em] text-[#e6c477]">
              A global community of faith
            </p>

            <h1 className="mb-5 font-[Manrope] text-[42px] font-medium leading-[1.12] tracking-[-0.055em] sm:text-5xl lg:text-[52px]">
              A place where faith meets{" "}
              <span className="text-[#e6c477]">community.</span>
            </h1>

            <p className="mb-7 max-w-[480px] text-sm leading-7 text-white/85 sm:text-[15px]">
              Connect with believers, share what’s on your heart, and
              experience the power of prayer—together.
            </p>

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

            <p className="mt-5 text-[9px] text-white/55">
              Free forever · A safe and caring community
            </p>
          </div>

          {/* Scripture footer */}
          <footer className="max-w-[558px] border-t border-white/15 pb-2 pt-5">
            <p className="text-[11px] font-medium leading-6 text-white/90">
              “Carry each other’s burdens, and in this way you will fulfill
              the law of Christ.”
            </p>
            <p className="mt-3 text-[8px] font-bold uppercase tracking-[0.15em] text-[#e6c477]">
              Galatians 6:2
            </p>
          </footer>
        </section>

        {/* Right image panel */}
        <section className="relative hidden min-h-screen p-[6px] lg:block">
          <div className="relative h-full w-full overflow-hidden rounded-[24px]">
            <Image
              src="/landing-hero.jpg"
              alt="Believers gathered together in prayer"
              fill
              priority
              sizes="47vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/5 to-black/45" />
          </div>
        </section>

        {/* Mobile image */}
        <section className="relative h-[330px] px-4 pb-4 lg:hidden">
          <div className="relative h-full w-full overflow-hidden rounded-2xl">
            <Image
              src="/landing-hero.jpg"
              alt="Believers gathered together in prayer"
              fill
              sizes="100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/5 to-black/35" />
          </div>
        </section>
      </div>
    </main>
  );
}
