"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { GalleryMosaic } from "@/components/gallery/gallery-mosaic";
import { CheckInStreak } from "@/components/checkin-streak";

function SuccessHeading() {
  const searchParams = useSearchParams();
  const isNew = searchParams.get("new") === "1";

  return (
    <h1 className="text-3xl font-bold">
      {isNew ? "Welcome to the Village!" : "Welcome back to the Village!"}
    </h1>
  );
}

export default function SuccessPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-6">
        <CheckInStreak>
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10">
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
        </CheckInStreak>
      </div>
      <Suspense fallback={<h1 className="text-3xl font-bold">Welcome to the Village!</h1>}>
        <SuccessHeading />
      </Suspense>
      <p className="mt-3 text-sm text-green-600 dark:text-green-400">
        Payment complete — thanks for supporting the Village!
      </p>
      <div className="mt-8 w-full max-w-sm">
        <GalleryMosaic />
      </div>
      <Link
        href="/"
        className="mt-8 inline-flex h-12 items-center rounded-2xl bg-[var(--color-accent)] px-8 text-white font-semibold transition-all hover:bg-[var(--color-accent-light)]"
      >
        Back to Home
      </Link>
    </main>
  );
}
