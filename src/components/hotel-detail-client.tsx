"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft, MapPin, Star, ChevronRight, MessageSquare, PenLine,
  Wifi, Car, Coffee, Dumbbell, Snowflake, Bath, Utensils, Tv,
  Clock, ShieldCheck, PawPrint, Baby, AlertTriangle, Phone, CreditCard,
} from "lucide-react";
import { HotelRecord, ReviewRecord } from "@/types";
import { getHotelImage, getHotelGallery, ratingLabel } from "@/lib/hotel-display";

/* ── Amenity icon mapping ── */
const AMENITY_ICONS: Record<string, React.ReactNode> = {
  "Internet": <Wifi className="h-5 w-5" />,
  "Free Parking": <Car className="h-5 w-5" />,
  "Breakfast Available": <Coffee className="h-5 w-5" />,
  "Breakfast Included": <Coffee className="h-5 w-5" />,
  "Fitness Equipment": <Dumbbell className="h-5 w-5" />,
  "Ac": <Snowflake className="h-5 w-5" />,
  "Hot Tub": <Bath className="h-5 w-5" />,
  "Pool": <Bath className="h-5 w-5" />,
  "Spa": <Bath className="h-5 w-5" />,
  "Restaurant": <Utensils className="h-5 w-5" />,
  "Bar": <Coffee className="h-5 w-5" />,
  "Tv": <Tv className="h-5 w-5" />,
  "Room Service": <Phone className="h-5 w-5" />,
};

function getIcon(amenity: string) {
  return AMENITY_ICONS[amenity] ?? <ShieldCheck className="h-5 w-5" />;
}

function hotelSubtitle(hotel: HotelRecord) {
  return [hotel.city, hotel.province, hotel.country].filter(Boolean).join(", ");
}

function cleanHtml(text: string) {
  return text.replace(/<\/?[^>]+(>|$)/g, "").replace(/\\n/g, " ").trim();
}

export function HotelDetailClient({ hotel }: { hotel: HotelRecord }) {
  const [reviewCount, setReviewCount] = useState(hotel.reviewCount);
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "policies">("overview");

  useEffect(() => {
    fetch(`/api/hotels/${hotel.id}/reviews`)
      .then((r) => r.json())
      .then((j) => {
        const revs = j.reviews ?? [];
        setReviews(revs);
        setReviewCount(revs.length);
      });
  }, [hotel.id]);

  const tabs = [
    { key: "overview" as const, label: "Overview" },
    { key: "policies" as const, label: "Policies" },
  ];

  return (
    <main className="min-h-screen bg-white text-slate-900">
      {/* ── Expedia Header ── */}
      <header className="bg-[#0a438b]">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-3">
          <Link href="/" className="text-2xl font-bold text-white tracking-tight">
            expedia
          </Link>
          <span className="rounded-full border border-white/30 px-4 py-1.5 text-xs font-semibold text-white/80">
            Adaptive Review Prompting
          </span>
        </div>
      </header>

      {/* ── Breadcrumb ── */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1200px] px-6 py-3">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Link href="/" className="text-[#1668e3] hover:underline">Hotels</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-slate-700">{hotel.name}</span>
          </div>
        </div>
      </div>

      {/* ── Image Gallery (Expedia 1+4 grid) ── */}
      <section className="mx-auto max-w-[1200px] px-6 pt-6">
        <div className="grid grid-cols-4 grid-rows-2 gap-1 overflow-hidden rounded-xl" style={{ height: 400 }}>
          <div className="relative col-span-2 row-span-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={getHotelImage(hotel)} alt={hotel.name} className="h-full w-full object-cover" />
          </div>
          {getHotelGallery(hotel).map((src, i) => (
            <div key={i} className="relative overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`Photo ${i + 2}`} className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
      </section>

      <div className="mx-auto max-w-[1200px] px-6">
        {/* ── Hotel Title + Rating Row ── */}
        <section className="mt-6 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              {hotel.starRating && (
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: Math.round(hotel.starRating) }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
              )}
            </div>
            <h1 className="mt-1 text-[28px] font-bold text-slate-900">{hotel.name}</h1>
            <div className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-500">
              <MapPin className="h-4 w-4" />
              {hotelSubtitle(hotel)}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-semibold text-slate-900">{ratingLabel(hotel.rating)}</div>
              <div className="text-xs text-slate-500">{reviewCount} reviews</div>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#1b6f3a]">
              <span className="text-lg font-bold text-white">{(hotel.rating ?? 8).toFixed(1)}</span>
            </div>
          </div>
        </section>

        {/* ── Action Buttons (Expedia style) ── */}
        <section className="mt-6 flex gap-3">
          <Link
            href={`/hotels/${hotel.id}/reviews`}
            className="inline-flex items-center gap-2 rounded-full border-2 border-[#1668e3] px-6 py-3 text-sm font-bold text-[#1668e3] transition hover:bg-blue-50"
          >
            <MessageSquare className="h-4 w-4" />
            Reviews & AI Analysis
          </Link>
          <Link
            href={`/hotels/${hotel.id}/write-review`}
            className="inline-flex items-center gap-2 rounded-full bg-[#1668e3] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#1254c4]"
          >
            <PenLine className="h-4 w-4" />
            Write a Review
          </Link>
        </section>

        {/* ── Tab Navigation ── */}
        <nav className="mt-8 flex border-b border-slate-200">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative px-6 py-3 text-sm font-semibold transition ${
                activeTab === tab.key
                  ? "text-[#1668e3]"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-[3px] rounded-t bg-[#1668e3]" />
              )}
            </button>
          ))}
        </nav>

        {/* ── Tab Content ── */}
        <div className="py-8">
          {activeTab === "overview" && (
            <OverviewTab hotel={hotel} reviewCount={reviewCount} reviews={reviews} />
          )}
          {activeTab === "policies" && (
            <PoliciesTab hotel={hotel} />
          )}
        </div>
      </div>
    </main>
  );
}

/* ══════════════════════════════════════════
   Overview Tab
   ══════════════════════════════════════════ */

function ratingWord10(r: number | null): string {
  if (!r) return "Good";
  if (r >= 9) return "Wonderful";
  if (r >= 8) return "Very Good";
  if (r >= 7) return "Good";
  return "Okay";
}

function parseOverall(raw: string): number | null {
  try {
    const obj = JSON.parse(raw);
    return typeof obj.overall === "number" && obj.overall > 0 ? obj.overall : null;
  } catch { return null; }
}

function reviewRatingLabel(score: number): string {
  if (score >= 4.5) return "Excellent";
  if (score >= 3.5) return "Good";
  if (score >= 2.5) return "Okay";
  return "Poor";
}

function OverviewTab({ hotel, reviewCount, reviews }: { hotel: HotelRecord; reviewCount: number; reviews: ReviewRecord[] }) {
  // Compute sub-ratings from review data
  const subRatings = (() => {
    const sums: Record<string, { total: number; count: number }> = {};
    for (const r of reviews) {
      try {
        const obj = JSON.parse(r.ratingRaw);
        for (const [key, val] of Object.entries(obj)) {
          if (key === "overall" || typeof val !== "number" || val <= 0) continue;
          if (!sums[key]) sums[key] = { total: 0, count: 0 };
          sums[key].total += val as number;
          sums[key].count += 1;
        }
      } catch { /* ignore */ }
    }
    const labels: Record<string, string> = {
      roomcleanliness: "Cleanliness",
      service: "Service",
      hotelcondition: "Condition",
      roomcomfort: "Comfort",
      roomamenitiesscore: "Amenities",
      convenienceoflocation: "Location",
    };
    return Object.entries(sums)
      .filter(([k]) => labels[k])
      .map(([k, v]) => ({ key: k, label: labels[k], avg: Math.round((v.total / v.count) * 10) / 10 }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 3);
  })();

  // Get top 4 reviews with text for the preview carousel
  const previewReviews = reviews
    .filter((r) => r.text.length > 30 && r.source === "seed")
    .slice(0, 4);

  return (
    <div>
      <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
        {/* Left column */}
        <div>
          {/* About this property */}
          <h2 className="text-[22px] font-bold text-slate-900">About this property</h2>
          <p className="mt-4 text-[15px] leading-7 text-slate-600">{hotel.description}</p>

          {/* Amenities as inline chips */}
          {hotel.popularAmenities.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {hotel.popularAmenities.slice(0, 10).map((a) => (
                <span key={a} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
                  <span className="text-slate-400">{getIcon(a)}</span>
                  {a}
                </span>
              ))}
              {hotel.popularAmenities.length > 10 && (
                <span className="rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-400">
                  +{hotel.popularAmenities.length - 10} more
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right column — Quick info card */}
        <div>
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#1b6f3a]">
                <span className="text-base font-bold text-white">{(hotel.rating ?? 8).toFixed(1)}</span>
              </div>
              <div>
                <div className="font-bold text-slate-900">{ratingLabel(hotel.rating)}</div>
                <button className="text-xs text-[#1668e3] hover:underline">{reviewCount} reviews</button>
              </div>
            </div>
            <hr className="my-5 border-slate-100" />
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Check-in</span>
                <span className="font-semibold">{hotel.checkIn.startTime ?? "3:00 PM"}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Check-out</span>
                <span className="font-semibold">{hotel.checkOut.time ?? "11:00 AM"}</span>
              </div>
            </div>
            <hr className="my-5 border-slate-100" />
            <Link
              href={`/hotels/${hotel.id}/write-review`}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[#1668e3] py-3 text-sm font-bold text-white transition hover:bg-[#1254c4]"
            >
              <PenLine className="h-4 w-4" />
              Write a Review
            </Link>
            <Link
              href={`/hotels/${hotel.id}/reviews`}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 py-3 text-sm font-bold text-slate-700 transition hover:border-[#1668e3] hover:text-[#1668e3]"
            >
              <MessageSquare className="h-4 w-4" />
              See Reviews & Analysis
            </Link>
          </div>
        </div>
      </div>

      {/* ═══ Reviews Section (Expedia style) ═══ */}
      <section className="mt-12 border-t border-slate-200 pt-10">
        <div className="flex items-start gap-10">
          {/* Left: Rating summary */}
          <div className="flex-shrink-0">
            <h2 className="text-[22px] font-bold text-slate-900">Reviews</h2>
            <div className="mt-3">
              <span className="text-4xl font-bold text-[#1b6f3a]">{(hotel.rating ?? 8).toFixed(1)}</span>
              <span className="text-xl text-[#1b6f3a]">/10</span>
            </div>
            <div className="mt-1 text-lg font-bold text-slate-900">{ratingWord10(hotel.rating)}</div>
            <div className="mt-0.5 text-sm text-slate-500">{reviewCount} verified reviews</div>

            {/* Sub-ratings */}
            {subRatings.length > 0 && (
              <div className="mt-5 flex gap-6">
                {subRatings.map((sr) => (
                  <div key={sr.key} className="text-center">
                    <div className="text-lg font-bold text-slate-900">{sr.avg}</div>
                    <div className="text-xs text-slate-500">{sr.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Review cards carousel */}
          <div className="flex min-w-0 flex-1 gap-4 overflow-x-auto pb-2">
            {previewReviews.map((review) => {
              const overall = parseOverall(review.ratingRaw);
              const score10 = overall ? overall * 2 : null;
              return (
                <div
                  key={review.id}
                  className="flex w-[280px] flex-shrink-0 flex-col justify-between rounded-xl border border-slate-200 p-5"
                >
                  <div>
                    {score10 && (
                      <div className="text-sm font-bold text-slate-900">
                        {score10.toFixed(0)}/10 {reviewRatingLabel(overall!)}
                      </div>
                    )}
                    <p className="mt-2 text-sm leading-5 text-slate-600 line-clamp-4">
                      {review.text}
                    </p>
                    <Link
                      href={`/hotels/${hotel.id}/reviews`}
                      className="mt-1.5 text-sm font-semibold text-[#1668e3] hover:underline"
                    >
                      See more
                    </Link>
                  </div>
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <div className="text-sm font-bold text-slate-700">Guest</div>
                    <div className="text-xs text-slate-500">{review.date}</div>
                    <div className="text-xs text-slate-400">Verified review</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* See all reviews button */}
        <div className="mt-6 flex justify-center">
          <Link
            href={`/hotels/${hotel.id}/reviews`}
            className="rounded-full border-2 border-slate-300 px-8 py-3 text-sm font-bold text-slate-700 transition hover:border-[#1668e3] hover:text-[#1668e3]"
          >
            See all {reviewCount} reviews
          </Link>
        </div>
      </section>
    </div>
  );
}

/* ══════════════════════════════════════════
   Policies Tab
   ══════════════════════════════════════════ */

function PolicySection({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="py-6 first:pt-0">
      <div className="flex items-center gap-3">
        <span className="text-slate-400">{icon}</span>
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      </div>
      <ul className="mt-4 space-y-2.5 pl-10">
        {items.map((item, i) => {
          const cleaned = cleanHtml(item);
          if (!cleaned) return null;
          return (
            <li key={i} className="flex items-start gap-2 text-[15px] text-slate-600">
              <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-slate-400" />
              {cleaned}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PoliciesTab({ hotel }: { hotel: HotelRecord }) {
  return (
    <div className="max-w-3xl">
      <h2 className="text-[22px] font-bold text-slate-900">Policies</h2>

      {/* Check-in */}
      <div className="mt-6 divide-y divide-slate-100">
        <div className="py-6">
          <div className="flex items-center gap-3">
            <span className="text-slate-400"><Clock className="h-5 w-5" /></span>
            <h3 className="text-lg font-bold text-slate-900">Check-in</h3>
          </div>
          <div className="mt-4 pl-10">
            <div className="flex items-center gap-8">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Start time</div>
                <div className="mt-1 text-lg font-bold text-slate-900">{hotel.checkIn.startTime ?? "3:00 PM"}</div>
              </div>
              {hotel.checkIn.endTime && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">End time</div>
                  <div className="mt-1 text-lg font-bold text-slate-900">{hotel.checkIn.endTime}</div>
                </div>
              )}
            </div>
            {hotel.checkIn.instructions.length > 0 && (
              <ul className="mt-4 space-y-2">
                {hotel.checkIn.instructions.map((inst, i) => (
                  <li key={i} className="flex items-start gap-2 text-[15px] text-slate-600">
                    <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-slate-400" />
                    {cleanHtml(inst)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Check-out */}
        <div className="py-6">
          <div className="flex items-center gap-3">
            <span className="text-slate-400"><CreditCard className="h-5 w-5" /></span>
            <h3 className="text-lg font-bold text-slate-900">Check-out</h3>
          </div>
          <div className="mt-4 pl-10">
            <div className="text-lg font-bold text-slate-900">{hotel.checkOut.time ?? "11:00 AM"}</div>
            {hotel.checkOut.policy.length > 0 && (
              <ul className="mt-4 space-y-2">
                {hotel.checkOut.policy.map((p, i) => (
                  <li key={i} className="flex items-start gap-2 text-[15px] text-slate-600">
                    <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-slate-400" />
                    {cleanHtml(p)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <PolicySection
          icon={<PawPrint className="h-5 w-5" />}
          title="Pet policy"
          items={hotel.policies.pet}
        />
        <PolicySection
          icon={<Baby className="h-5 w-5" />}
          title="Children and extra beds"
          items={hotel.policies.childrenAndExtraBed}
        />
        <PolicySection
          icon={<AlertTriangle className="h-5 w-5" />}
          title="Important information"
          items={hotel.policies.knowBeforeYouGo}
        />
      </div>
    </div>
  );
}
