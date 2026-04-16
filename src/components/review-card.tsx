"use client";

import { ReviewRecord, PipelineReviewLabel } from "@/types";
import { useState } from "react";

function parseRatings(raw: string | undefined): { overall: number | null; details: { label: string; score: number }[] } {
  if (!raw) return { overall: null, details: [] };
  try {
    const obj = JSON.parse(raw);
    const overall = typeof obj.overall === "number" && obj.overall > 0 ? obj.overall : null;
    const LABELS: Record<string, string> = {
      roomcleanliness: "Cleanliness",
      service: "Service",
      roomcomfort: "Comfort",
      hotelcondition: "Condition",
      roomamenitiesscore: "Amenities",
      convenienceoflocation: "Location",
      valueformoney: "Value",
    };
    const details: { label: string; score: number }[] = [];
    for (const [key, val] of Object.entries(obj)) {
      if (key === "overall") continue;
      if (typeof val === "number" && val > 0 && LABELS[key]) {
        details.push({ label: LABELS[key], score: val });
      }
    }
    return { overall, details };
  } catch {
    return { overall: null, details: [] };
  }
}

function ratingWord(score: number): string {
  if (score >= 4.5) return "Excellent";
  if (score >= 3.5) return "Good";
  if (score >= 2.5) return "Okay";
  return "Poor";
}

function LabelBadge({ label }: { label: PipelineReviewLabel }) {
  if (label.display_action === "highlight") {
    return (
      <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700" title={label.note}>
        Fresh
      </span>
    );
  }
  if (label.display_action === "warn") {
    return (
      <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700" title={label.note}>
        May be outdated
      </span>
    );
  }
  if (label.display_action === "hide" || label.display_action === "deprioritize") {
    return (
      <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700" title={label.note}>
        May be outdated
      </span>
    );
  }
  return null;
}

export function ReviewCard({ review, labels }: { review: ReviewRecord; labels?: PipelineReviewLabel[] }) {
  const { overall, details } = parseRatings(review.ratingRaw);
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div className="py-6">
      {/* Rating + date row */}
      <div className="flex items-start justify-between">
        <div>
          {overall !== null && (
            <div className="text-[15px] font-bold text-slate-900">
              {(overall * 2).toFixed(0)}/10 {ratingWord(overall)}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-2 text-sm text-slate-500">
            <span className="font-semibold text-slate-700">Guest</span>
            <span>·</span>
            <span>{review.source === "user" ? "Just now" : review.date}</span>
            {review.source === "seed" && (
              <>
                <span>·</span>
                <span className="text-emerald-600">Verified review</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(review.qualityScore ?? 0) >= 4 && (
            <span className="rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs font-semibold text-[#1668e3]" title={`Quality score: ${review.qualityScore}/5 — specific, actionable detail`}>
              High quality
            </span>
          )}
          {(overall === null || overall <= 3) && labels
            ?.filter((l) => l.label !== "FRESH")
            .filter((l, i, arr) => arr.findIndex((x) => x.display_action === l.display_action) === i)
            .map((label, i) => <LabelBadge key={i} label={label} />)}
          {review.source === "user" && (
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-[#1668e3]">New</span>
          )}
        </div>
      </div>

      {/* Title + text */}
      {review.title && (
        <p className="mt-3 text-[15px] font-semibold text-slate-800">{review.title}</p>
      )}
      <p className="mt-1.5 text-[15px] leading-7 text-slate-600">{review.text}</p>

      {/* Sub-ratings (collapsible) */}
      {details.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-sm font-semibold text-[#1668e3] hover:underline"
          >
            {showDetails ? "Hide rating details" : "Show rating details"}
          </button>
          {showDetails && (
            <div className="mt-2 flex flex-wrap gap-4">
              {details.map((d) => (
                <div key={d.label} className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500">{d.label}</span>
                  <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-[#1b6f3a]" style={{ width: `${(d.score / 5) * 100}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-slate-600">{d.score}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
