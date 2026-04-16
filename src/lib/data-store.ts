import hotelsData from "@/data/hotels.json";
import seededReviews from "@/data/reviews-by-hotel.json";
import issuesData from "@/data/issues.json";
import reviewLabelsData from "@/data/review-labels.json";
import dimensionCoverageData from "@/data/dimension-coverage.json";
import timeStaleData from "@/data/time-stale.json";
import type {
  HotelRecord,
  ReviewRecord,
  PipelineIssue,
  PipelineReviewLabel,
  PipelineDimensionCoverage,
  PipelineTimeStale,
} from "@/types";

const userReviewStore = new Map<string, ReviewRecord[]>();

const hotels = hotelsData as HotelRecord[];
const reviewMap = seededReviews as Record<string, Array<Omit<ReviewRecord, "id" | "source">>>;

const issuesMap = issuesData as Record<string, PipelineIssue[]>;
const labelsMap = reviewLabelsData as Record<string, PipelineReviewLabel[]>;
const coverageMap = dimensionCoverageData as Record<string, PipelineDimensionCoverage[]>;
const staleMap = timeStaleData as Record<string, PipelineTimeStale[]>;

function stableId(prefix: string, index: number) {
  return `${prefix}-${index + 1}`;
}

export function listHotels(): HotelRecord[] {
  return hotels;
}

export function getHotelById(id: string): HotelRecord | undefined {
  return hotels.find((hotel) => hotel.id === id);
}

export function getReviewsForHotel(id: string): ReviewRecord[] {
  const base = (reviewMap[id] ?? []).map((review, index) => ({
    ...review,
    id: stableId(id, index),
    source: "seed" as const,
  }));
  const user = userReviewStore.get(id) ?? [];
  return [...user, ...base].filter((review) => review.text.trim().length > 0);
}

export function addReviewForHotel(id: string, payload: { title?: string; text: string }) {
  const existing = userReviewStore.get(id) ?? [];
  const review: ReviewRecord = {
    id: `user-${Date.now()}`,
    date: new Date().toLocaleDateString("en-US"),
    title: payload.title?.trim() || null,
    text: payload.text.trim(),
    ratingRaw: "{}",
    source: "user",
  };
  userReviewStore.set(id, [review, ...existing]);
  return review;
}

/* ───── Pipeline pre-computed data accessors ───── */

export function getIssuesForHotel(id: string): PipelineIssue[] {
  return issuesMap[id] ?? [];
}

export function getReviewLabelsForHotel(id: string): PipelineReviewLabel[] {
  return labelsMap[id] ?? [];
}

export function getDimensionCoverageForHotel(id: string): PipelineDimensionCoverage[] {
  return coverageMap[id] ?? [];
}

export function getTimeStaleForHotel(id: string): PipelineTimeStale[] {
  return staleMap[id] ?? [];
}

export function hasPipelineData(id: string): boolean {
  return id in coverageMap;
}
