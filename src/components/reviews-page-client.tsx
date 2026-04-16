"use client";

import Link from "next/link";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  ArrowLeft, PenLine, ChevronDown, ChevronRight, Search, X, AlertTriangle, Eye, EyeOff,
} from "lucide-react";
import type {
  HotelRecord, ReviewRecord,
  PipelineReviewLabel, PipelineIssue,
} from "@/types";
import { ReviewCard } from "@/components/review-card";
import { ratingLabel } from "@/lib/hotel-display";

/* ── Helpers ── */

function normalizeDate(d: string): string {
  if (!d) return "";
  const parts = d.split("/");
  if (parts.length === 3) {
    const [m, day, y] = parts;
    const year = parseInt(y) < 100 ? 2000 + parseInt(y) : parseInt(y);
    return `${year}-${m.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return d;
}

function findLabelsForReview(review: ReviewRecord, labels: PipelineReviewLabel[]): PipelineReviewLabel[] {
  const reviewDate = normalizeDate(review.date);
  return labels.filter((l) => normalizeDate(l.review_date) === reviewDate);
}

function parseOverall(raw: string): number | null {
  try {
    const obj = JSON.parse(raw);
    return typeof obj.overall === "number" && obj.overall > 0 ? obj.overall : null;
  } catch { return null; }
}

function computeSubRatings(reviews: ReviewRecord[]) {
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
    service: "Staff & service",
    hotelcondition: "Property conditions",
    roomamenitiesscore: "Amenities",
    roomcomfort: "Comfort",
    convenienceoflocation: "Location",
  };
  return Object.entries(sums)
    .filter(([k]) => labels[k])
    .map(([k, v]) => ({ key: k, label: labels[k]!, avg: Math.round((v.total / v.count) * 10) / 10 }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 4);
}

/* ── Build "What guests liked" from Pipeline issues (inverted — what's good) ── */
function buildGuestLiked(reviews: ReviewRecord[], issues: PipelineIssue[]): string[] {
  const liked: string[] = [];
  // Find dimensions NOT in issues (= well covered, no problems)
  const issuesDims = new Set(issues.map((i) => i.dimension));

  // Count topic mentions in review text
  const topicCounts: Record<string, number> = {};
  const keywords: Record<string, string[]> = {
    "staff and service": ["staff", "service", "friendly", "helpful"],
    "location and convenience": ["location", "convenient", "close to", "walking distance"],
    "room cleanliness": ["clean", "tidy", "spotless"],
    "breakfast": ["breakfast", "buffet", "morning meal"],
    "parking": ["parking", "garage", "car"],
    "pool and amenities": ["pool", "gym", "spa", "fitness"],
  };

  for (const r of reviews) {
    const text = r.text.toLowerCase();
    for (const [topic, kws] of Object.entries(keywords)) {
      if (kws.some((kw) => text.includes(kw))) {
        topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
      }
    }
  }

  // Take top mentioned positive topics
  const sorted = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  for (const [topic, count] of sorted) {
    liked.push(`${topic.charAt(0).toUpperCase() + topic.slice(1)} was frequently praised by guests. (${count} reviews)`);
  }

  return liked;
}

const LOW_QUALITY_THRESHOLD = 50; // chars
const INITIAL_LOAD = 10;
const LOAD_MORE = 5;

function isLowQuality(review: ReviewRecord): boolean {
  return review.text.trim().length < LOW_QUALITY_THRESHOLD;
}

function isHighQualityScore(review: ReviewRecord): boolean {
  return (review.qualityScore ?? 0) >= 4;
}

/**
 * Smart "most relevant" ranking — weight priority:
 *  1. Outdated reviews pushed to the back (highest weight)
 *  2. Review quality — pipeline score (second weight)
 *  3. Dimension diversity — greedy reorder for first page (third weight)
 *  4. Time of publish — newer first (lowest weight)
 */
function rankMostRelevant(
  reviews: ReviewRecord[],
  labels: PipelineReviewLabel[],
): ReviewRecord[] {
  const now = Date.now();

  // Build stale set from labels (normalize dates so formats match)
  const staleDates = new Set<string>();
  for (const l of labels) {
    if (l.label === "STALE" || l.label === "ONGOING_STALE" || l.label === "RESOLVED_STALE") {
      staleDates.add(normalizeDate(l.review_date));
    }
  }

  // Also mark reviews with "warn" display_action (may be outdated) as stale
  for (const l of labels) {
    if (l.display_action === "warn" || l.display_action === "hide" || l.display_action === "deprioritize") {
      staleDates.add(normalizeDate(l.review_date));
    }
  }

  // W1: Separate stale → always at back
  const stale: ReviewRecord[] = [];
  const fresh: ReviewRecord[] = [];
  for (const r of reviews) {
    if (staleDates.has(normalizeDate(r.date))) {
      stale.push(r);
    } else {
      fresh.push(r);
    }
  }

  // Score fresh reviews: quality (W2) >> recency (W4)
  const scored = fresh.map((r) => {
    let score = 0;

    // User reviews always on top
    if (r.source === "user") score += 500;

    // W2: Quality (highest weight among scored factors)
    const qs = r.qualityScore ?? 0;
    if (qs >= 5) score += 100;
    else if (qs >= 4) score += 80;
    else if (qs === 3) score += 40;
    else if (qs === 2) score += 15;
    // Fallback: no pipeline score → use text length as proxy
    else if (!r.qualityScore && r.text.length > 200) score += 50;
    else if (!r.qualityScore && r.text.length > 100) score += 30;
    else if (!r.qualityScore && r.text.length > 50) score += 15;

    // W4: Recency (lowest weight — tiebreaker)
    const dateMs = new Date(normalizeDate(r.date)).getTime() || 0;
    const daysSince = dateMs > 0 ? (now - dateMs) / 86400000 : 9999;
    if (daysSince < 30) score += 20;
    else if (daysSince < 90) score += 16;
    else if (daysSince < 180) score += 12;
    else if (daysSince < 365) score += 8;
    else if (daysSince < 730) score += 4;

    return { review: r, score, dims: r.dimensions ?? [] };
  });

  // Sort by score desc, then date desc as final tiebreaker
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = new Date(normalizeDate(a.review.date)).getTime() || 0;
    const db = new Date(normalizeDate(b.review.date)).getTime() || 0;
    return db - da;
  });

  // W3: Dimension diversity — greedy reorder for first INITIAL_LOAD slots
  const pool = scored.slice(0, Math.min(INITIAL_LOAD * 3, scored.length));
  const rest = scored.slice(INITIAL_LOAD * 3);
  const picked: typeof scored = [];
  const seenDims = new Set<string>();
  const used = new Set<number>();

  for (let slot = 0; slot < Math.min(INITIAL_LOAD, pool.length); slot++) {
    let bestIdx = -1;
    let bestNewDims = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      if (used.has(i)) continue;
      const newDims = pool[i].dims.filter((d) => !seenDims.has(d)).length;
      // W3 > W4: prefer dimension diversity, break ties by quality+recency score
      if (newDims > bestNewDims || (newDims === bestNewDims && pool[i].score > bestScore)) {
        bestIdx = i;
        bestNewDims = newDims;
        bestScore = pool[i].score;
      }
    }

    if (bestIdx >= 0) {
      used.add(bestIdx);
      picked.push(pool[bestIdx]);
      for (const d of pool[bestIdx].dims) seenDims.add(d);
    }
  }

  // Remaining from pool + rest, sorted by score
  const remaining = pool.filter((_, i) => !used.has(i)).concat(rest);
  remaining.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = new Date(normalizeDate(a.review.date)).getTime() || 0;
    const db = new Date(normalizeDate(b.review.date)).getTime() || 0;
    return db - da;
  });

  // Stale reviews at the very end, sorted by date desc
  stale.sort((a, b) => {
    const da = new Date(normalizeDate(a.date)).getTime() || 0;
    const db = new Date(normalizeDate(b.date)).getTime() || 0;
    return db - da;
  });

  return [...picked.map((s) => s.review), ...remaining.map((s) => s.review), ...stale];
}

export function ReviewsPageClient({ hotel }: { hotel: HotelRecord }) {
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [labels, setLabels] = useState<PipelineReviewLabel[]>([]);
  const [issues, setIssues] = useState<PipelineIssue[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [searchText, setSearchText] = useState("");
  const [sortBy, setSortBy] = useState("most_relevant");
  const [showLowQuality, setShowLowQuality] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_LOAD);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/hotels/${hotel.id}/reviews`).then((r) => r.json()),
      fetch(`/api/hotels/${hotel.id}/pipeline-analysis`).then((r) => r.json()),
    ]).then(([reviewsData, pipelineData]) => {
      const allReviews: ReviewRecord[] = reviewsData.reviews ?? [];
      // Filter out non-English reviews (e.g. German)
      const DE_WORDS = new Set(["der", "die", "das", "und", "ist", "war", "sehr", "wir", "ich", "ein", "eine", "nicht", "mit", "auch", "hat", "aber", "für", "dem", "den", "des", "sich", "von"]);
      const enReviews = allReviews.filter((r) => {
        if (r.source === "user") return true; // always keep user reviews
        const words = r.text.toLowerCase().split(/\s+/);
        if (words.length <= 3) return true;
        const deCount = words.filter((w) => DE_WORDS.has(w)).length;
        return deCount / words.length < 0.15;
      });
      setReviews(enReviews);
      setReviewCount(enReviews.length);
      setLabels(pipelineData.reviewLabels ?? []);
      setIssues(pipelineData.issues ?? []);
    });
  }, [hotel.id]);

  const subRatings = useMemo(() => computeSubRatings(reviews), [reviews]);
  const guestLiked = useMemo(() => buildGuestLiked(reviews, issues), [reviews, issues]);

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(INITIAL_LOAD);
  }, [searchText, sortBy]);

  const { highQualityReviews, lowQualityReviews } = useMemo(() => {
    let result = [...reviews];
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = result.filter((r) =>
        r.text.toLowerCase().includes(q) || (r.title ?? "").toLowerCase().includes(q),
      );
    }

    // Split into low/high quality text first
    const hq = result.filter((r) => !isLowQuality(r));
    const lq = result.filter((r) => isLowQuality(r));

    // Sort high-quality reviews
    if (sortBy === "most_relevant") {
      return {
        highQualityReviews: rankMostRelevant(hq, labels),
        lowQualityReviews: lq,
      };
    }

    const sortFn = (a: ReviewRecord, b: ReviewRecord) => {
      if (sortBy === "newest") {
        const da = new Date(normalizeDate(a.date)).getTime() || 0;
        const db = new Date(normalizeDate(b.date)).getTime() || 0;
        return db - da;
      } else if (sortBy === "highest") {
        return (parseOverall(b.ratingRaw) ?? 0) - (parseOverall(a.ratingRaw) ?? 0);
      } else if (sortBy === "lowest") {
        return (parseOverall(a.ratingRaw) ?? 0) - (parseOverall(b.ratingRaw) ?? 0);
      }
      return 0;
    };

    hq.sort(sortFn);
    lq.sort(sortFn);
    return { highQualityReviews: hq, lowQualityReviews: lq };
  }, [reviews, searchText, sortBy, labels]);

  // Infinite scroll: observe sentinel element
  const loadMore = useCallback(() => {
    setVisibleCount((prev) => prev + LOAD_MORE);
  }, []);

  const visibleReviews = highQualityReviews.slice(0, visibleCount);
  const hasMore = visibleCount < highQualityReviews.length;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, hasMore]);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      {/* ── Header ── */}
      <header className="bg-[#0a438b]">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-3">
          <Link href="/" className="text-2xl font-bold text-white tracking-tight">expedia</Link>
          <span className="rounded-full border border-white/30 px-4 py-1.5 text-xs font-semibold text-white/80">
            Adaptive Review Prompting
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-[1200px] px-6 py-6">
        {/* ── Title bar ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={`/hotels/${hotel.id}`}
              className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100"
            >
              <X className="h-5 w-5 text-slate-600" />
            </Link>
            <h1 className="text-xl font-bold text-slate-900">Guest reviews</h1>
          </div>
          <Link
            href={`/hotels/${hotel.id}/write-review`}
            className="inline-flex items-center gap-2 rounded-full bg-[#1668e3] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#1254c4]"
          >
            <PenLine className="h-4 w-4" />
            Write a review
          </Link>
        </div>

        {/* ── Two-column layout ── */}
        <div className="mt-6 grid gap-8 lg:grid-cols-[300px_1fr]">
          {/* ═══ Left sidebar ═══ */}
          <div>
            {/* What guests liked */}
            {guestLiked.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="text-sm font-bold text-slate-900">What guests liked</h3>
                <ul className="mt-3 space-y-2.5">
                  {guestLiked.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                      <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-slate-400" />
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 flex items-center gap-1 text-[11px] text-slate-400">
                  <span className="text-[#1668e3]">✦</span> From real guest reviews summarized by AI
                </p>
              </div>
            )}

            {/* Sub-ratings */}
            {subRatings.length > 0 && (
              <div className="mt-6 space-y-3">
                {subRatings.map((sr) => (
                  <div key={sr.key} className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">{sr.label}</span>
                    <span className="text-sm font-bold text-slate-900">{sr.avg}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Overall score */}
            <div className="mt-6 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#1b6f3a]">
                <span className="text-lg font-bold text-white">{(hotel.rating ?? 8).toFixed(1)}</span>
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">{ratingLabel(hotel.rating)}</div>
                <div className="text-xs text-slate-500">{reviewCount} verified reviews</div>
              </div>
            </div>
          </div>

          {/* ═══ Right: Review list ═══ */}
          <div>

            {/* Filter bar */}
            <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
              {/* Search */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search reviews"
                  className="rounded-full border border-slate-300 bg-white py-2 pl-9 pr-4 text-sm text-slate-700 placeholder:text-slate-400 focus:border-[#1668e3] focus:outline-none"
                />
              </div>

              {/* Sort */}
              <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
                Sort by
                <div className="relative">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="appearance-none rounded-full border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm font-semibold text-slate-700 hover:border-slate-400"
                  >
                    <option value="most_relevant">Most relevant</option>
                    <option value="newest">Newest</option>
                    <option value="highest">Highest rating</option>
                    <option value="lowest">Lowest rating</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                </div>
              </div>
            </div>

            {/* Review count + quality breakdown */}
            <div className="mb-2 text-xs text-slate-400">
              Showing {Math.min(visibleCount, highQualityReviews.length)} of {highQualityReviews.length} detailed reviews
              {highQualityReviews.filter(isHighQualityScore).length > 0 && (
                <> &middot; {highQualityReviews.filter(isHighQualityScore).length} high-quality</>
              )}
            </div>

            {/* Reviews — infinite scroll */}
            <div className="divide-y divide-slate-100">
              {visibleReviews.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  labels={findLabelsForReview(review, labels)}
                />
              ))}

              {/* Infinite scroll sentinel */}
              {hasMore && (
                <div ref={sentinelRef} className="flex items-center justify-center py-8">
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-transparent" />
                    Loading more reviews...
                  </div>
                </div>
              )}

              {!hasMore && highQualityReviews.length > INITIAL_LOAD && (
                <div className="py-4 text-center text-xs text-slate-400">
                  All {highQualityReviews.length} detailed reviews shown
                </div>
              )}
            </div>

            {/* Low-quality reviews fold */}
            {lowQualityReviews.length > 0 && (
              <div className="mt-4">
                <button
                  onClick={() => setShowLowQuality(!showLowQuality)}
                  className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 transition hover:bg-slate-100"
                >
                  {showLowQuality ? (
                    <EyeOff className="h-4 w-4 text-slate-400" />
                  ) : (
                    <Eye className="h-4 w-4 text-slate-400" />
                  )}
                  <span className="font-medium">
                    {showLowQuality ? "Hide" : "Show"} {lowQualityReviews.length} brief review{lowQualityReviews.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-slate-400">
                    — short reviews with limited detail
                  </span>
                  <ChevronDown
                    className={`ml-auto h-4 w-4 text-slate-400 transition-transform ${
                      showLowQuality ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {showLowQuality && (
                  <div className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-100 bg-slate-50/50">
                    {lowQualityReviews.map((review) => (
                      <ReviewCard
                        key={review.id}
                        review={review}
                        labels={findLabelsForReview(review, labels)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {highQualityReviews.length === 0 && lowQualityReviews.length === 0 && (
              <div className="py-16 text-center text-slate-400">
                No reviews match your search.
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
