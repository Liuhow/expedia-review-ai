"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, MapPin, Star } from "lucide-react";
import type { HotelRecord, ReviewRecord } from "@/types";
import { getHotelImage } from "@/lib/hotel-display";
import { ReviewCompositionSection } from "@/components/review-composition-section";

export function WriteReviewPageClient({ hotel }: { hotel: HotelRecord }) {
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch(`/api/hotels/${hotel.id}/reviews`)
      .then((r) => r.json())
      .then((j) => setReviews(j.reviews ?? []));
  }, [hotel.id]);

  return (
    <main className="min-h-screen bg-[#f8f7f4] text-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="rounded-full bg-[#0a438b] px-5 py-2 text-lg font-bold text-white">
            expedia
          </Link>
          <span className="text-sm font-medium text-slate-500">Adaptive Review Prompting System</span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Back */}
        <Link
          href={`/hotels/${hotel.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0a438b] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to {hotel.name}
        </Link>

        {/* Hotel context bar */}
        <div className="mt-6 flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getHotelImage(hotel)}
            alt={hotel.name}
            className="h-16 w-24 rounded-lg object-cover"
          />
          <div>
            <h2 className="font-bold text-slate-900">{hotel.name}</h2>
            <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-500">
              <MapPin className="h-3.5 w-3.5" />
              {[hotel.city, hotel.country].filter(Boolean).join(", ")}
              {hotel.starRating && (
                <span className="ml-2 flex items-center gap-0.5">
                  {Array.from({ length: Math.round(hotel.starRating) }).map((_, i) => (
                    <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
                  ))}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Page title */}
        <h1 className="mt-8 text-3xl font-bold text-slate-900">Write Your Review</h1>
        <p className="mt-2 text-slate-500">
          Share your experience. Our AI will ask one smart follow-up question based on what this property needs most.
        </p>

        {/* Review form */}
        {submitted ? (
          <div className="mt-10 rounded-2xl border border-green-200 bg-green-50 p-10 text-center">
            <div className="text-4xl">✓</div>
            <h2 className="mt-4 text-2xl font-bold text-green-800">Thank you for your review!</h2>
            <p className="mt-2 text-green-700">
              Your feedback helps future travelers make better decisions.
            </p>
            <Link
              href={`/hotels/${hotel.id}/reviews`}
              className="mt-6 inline-block rounded-full bg-[#0a438b] px-8 py-3 font-bold text-white"
            >
              View all reviews
            </Link>
          </div>
        ) : (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <ReviewCompositionSection
              hotel={hotel}
              existingReviews={reviews}
              onReviewSubmit={async () => {
                setSubmitted(true);
              }}
            />
          </div>
        )}
      </div>
    </main>
  );
}
