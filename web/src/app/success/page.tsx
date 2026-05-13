"use client";

import Link from "next/link";

export default function SuccessPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10 mb-6">
        <svg
          className="h-10 w-10 text-green-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h1 className="text-3xl font-bold">Payment Complete</h1>
      <p className="mt-3 text-lg text-[var(--color-muted)]">
        Thanks for supporting the studio. Enjoy the session!
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex h-12 items-center rounded-2xl bg-[var(--color-accent)] px-8 text-white font-semibold transition-all hover:bg-[var(--color-accent-light)]"
      >
        Back to Home
      </Link>
    </main>
  );
}
