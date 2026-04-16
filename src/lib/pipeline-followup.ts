import type { FollowUpResponse } from "@/types";
import { getIssuesForHotel } from "./data-store";

/* ───── Coarse topic groups ───── */

const DIMENSION_TO_COARSE: Record<string, string> = {
  room_cleanliness: "room",
  bathroom: "room",
  smell: "room",
  bed_comfort: "room",
  room_size: "room",
  room_view: "room",
  room_noise: "room",
  room_climate: "room",
  decor_renovation: "room",
  balcony: "room",
  housekeeping: "room",
  staff_attitude: "service",
  value_for_money: "service",
  checkin_experience: "service",
  breakfast: "breakfast",
  pool: "pool",
  kids_pool: "pool",
  parking: "parking",
  location: "location",
  wifi: "wifi",
  gym_fitness: "facilities",
  spa: "facilities",
  hot_tub: "facilities",
  restaurant: "dining",
  bar: "dining",
  elevator: "facilities",
  laundry: "facilities",
  room_service: "dining",
  outdoor: "facilities",
  business: "facilities",
  kitchen: "facilities",
  entertainment: "facilities",
  lobby: "facilities",
};

/* ───── Default chips per topic (used for initial questions when no LLM) ───── */

const DEFAULT_CHIPS: Record<string, { pos: string[]; neg: string[] }> = {
  room: { pos: ["Spacious", "Clean", "Comfortable bed", "Quiet", "Nice view", "Good AC"], neg: ["Too small", "Not clean", "Uncomfortable bed", "Noisy", "Bad view", "Poor AC"] },
  service: { pos: ["Friendly staff", "Quick response", "Helpful concierge", "Smooth check-in", "Attentive", "Professional"], neg: ["Slow response", "Unfriendly", "Unhelpful", "Long check-in wait", "Inattentive", "Unprofessional"] },
  breakfast: { pos: ["Good variety", "Fresh food", "Nice setting", "Quick service", "Local options", "Kid-friendly"], neg: ["Limited options", "Not fresh", "Crowded", "Slow service", "Repetitive", "Overpriced"] },
  pool: { pos: ["Clean water", "Good size", "Nice loungers", "Well-maintained", "Not crowded", "Good for kids"], neg: ["Dirty water", "Too small", "No loungers", "Poorly maintained", "Too crowded", "Unsafe for kids"] },
  parking: { pos: ["Easy to find", "Affordable", "Secure", "Close to entrance", "Spacious spots", "Well-lit"], neg: ["Hard to find", "Expensive", "Not secure", "Far from entrance", "Tight spaces", "Poorly lit"] },
  location: { pos: ["Near attractions", "Quiet area", "Good restaurants nearby", "Easy transport", "Safe neighborhood", "Walkable"], neg: ["Far from attractions", "Noisy area", "Few restaurants", "Bad transport", "Unsafe feeling", "Not walkable"] },
  wifi: { pos: ["Fast speed", "Reliable", "Good in room", "Free", "Easy to connect", "Strong signal"], neg: ["Slow speed", "Unreliable", "Weak in room", "Not free", "Hard to connect", "Keeps dropping"] },
  facilities: { pos: ["Well-equipped gym", "Nice spa", "Clean", "Modern", "Well-maintained", "Good hours"], neg: ["Outdated gym", "Poor spa", "Not clean", "Old equipment", "Poorly maintained", "Limited hours"] },
  dining: { pos: ["Tasty food", "Good variety", "Nice ambiance", "Reasonable prices", "Quick service", "Fresh ingredients"], neg: ["Bland food", "Limited menu", "Bad ambiance", "Overpriced", "Slow service", "Not fresh"] },
};

function getDefaultChips(coarseTopic: string, sentiment: "positive" | "negative" | "neutral"): { quickReplies: string[]; negativeChips: string[] } {
  const entry = DEFAULT_CHIPS[coarseTopic] ?? DEFAULT_CHIPS["room"];
  if (sentiment === "positive") return { quickReplies: entry.pos.slice(0, 6), negativeChips: [] };
  if (sentiment === "negative") return { quickReplies: entry.neg.slice(0, 6), negativeChips: entry.neg.slice(0, 6) };
  return { quickReplies: [...entry.pos.slice(0, 3), ...entry.neg.slice(0, 3)], negativeChips: entry.neg.slice(0, 3) };
}

/* ───── Sentiment detection (used for initial follow-ups only) ───── */

function detectSentiment(rating: number): "positive" | "negative" | "neutral" {
  if (rating >= 8) return "positive";
  if (rating <= 4 && rating > 0) return "negative";
  return "neutral";
}

/* ───── Main exports ───── */

export interface PipelineFollowUpResult extends FollowUpResponse {
  _pipelineDimension?: string;
  _issueType?: string;
  _evidence?: string;
  _isMultiSelect?: boolean;
}

/**
 * Initial follow-ups (empty textarea state). Returns top priority questions.
 */
export function getInitialFollowUps(
  hotelId: string,
  limit: number = 3,
  rating: number = 0,
): PipelineFollowUpResult[] {
  const issues = getIssuesForHotel(hotelId);
  if (issues.length === 0) return [];

  const sentiment = detectSentiment(rating);
  const results: PipelineFollowUpResult[] = [];
  const usedCoarse = new Set<string>();

  for (const issue of issues) {
    const coarse = DIMENSION_TO_COARSE[issue.dimension] || issue.dimension;
    if (usedCoarse.has(coarse)) continue;
    usedCoarse.add(coarse);

    const label = issue.dimension_label || issue.dimension;

    results.push({
      topic: coarse,
      question: `How was the ${label}?`,
      rationale: "Few guests mentioned this — your input is valuable.",
      ...getDefaultChips(coarse, sentiment),
      _pipelineDimension: issue.dimension,
      _issueType: issue.issue_type,
      _evidence: issue.evidence_a,
      _isMultiSelect: true,
    });

    if (results.length >= limit) break;
  }

  return results;
}

/**
 * Build comprehensive context for the LLM follow-up call.
 * Returns pipeline issues summary and available dimensions.
 */
export function getFollowUpContext(
  hotelId: string,
  answeredTopics: string[] = [],
): { issuesSummary: string; availableDimensions: string[] } {
  const issues = getIssuesForHotel(hotelId);
  const answeredSet = new Set(answeredTopics.map((t) => t.toLowerCase()));

  // Build rich issue descriptions for LLM
  const issueLines: string[] = [];
  const seenCoarse = new Set<string>();

  for (const issue of issues) {
    const coarse = DIMENSION_TO_COARSE[issue.dimension] || issue.dimension;
    if (seenCoarse.has(coarse)) continue;
    seenCoarse.add(coarse);

    const label = issue.dimension_label || issue.dimension;
    const type = issue.issue_type === "stale" ? "STALE/OUTDATED" : "INFORMATION GAP";
    const staleDetail = issue.stale_type
      ? ` (${issue.stale_type.replace("4a_", "conflicting reviews").replace("4b_", "contradicting info").replace("4c_", "temporary event: ").replace("4d_", "time-stale: ")}${issue.event_type ? ` — ${issue.event_type}` : ""})`
      : "";
    const evidence = issue.evidence_a ? ` | Evidence: "${issue.evidence_a}"` : "";
    const skipped = answeredSet.has(coarse) ? " [ALREADY ANSWERED — SKIP]" : "";

    issueLines.push(
      `- [${type}] ${label} (topic: ${coarse}), priority: ${issue.priority_score}/100${staleDetail}${evidence}${skipped}`
    );
  }

  // Available dimensions = all issue dimensions minus answered ones
  const availableDimensions: string[] = [];
  const seenLabels = new Set<string>();
  for (const issue of issues) {
    const label = (issue.dimension_label || issue.dimension).toLowerCase();
    const coarse = DIMENSION_TO_COARSE[issue.dimension] || issue.dimension;
    if (seenLabels.has(label) || answeredSet.has(coarse)) continue;
    seenLabels.add(label);
    availableDimensions.push(label);
  }

  return {
    issuesSummary: issueLines.join("\n"),
    availableDimensions,
  };
}

/**
 * Get pipeline issues summary for LLM context (used by polish endpoint).
 */
export function getPipelineIssuesForLLM(hotelId: string) {
  const issues = getIssuesForHotel(hotelId);
  const seenCoarse = new Set<string>();
  const result = [];

  for (const issue of issues) {
    const coarse = DIMENSION_TO_COARSE[issue.dimension] || issue.dimension_label || issue.dimension;
    if (seenCoarse.has(coarse)) continue;
    seenCoarse.add(coarse);
    result.push({
      dimension: issue.dimension,
      coarseTopic: coarse,
      issueType: issue.issue_type,
      staleType: issue.stale_type || issue.gap_type || "",
      priority: issue.priority_score,
      evidence: issue.evidence_a || "",
    });
  }

  return { issues: result };
}

/* ───── Exports kept for backward compatibility ───── */

export function getCoarseTopics(hotelId: string): string[] {
  const issues = getIssuesForHotel(hotelId);
  const seen = new Set<string>();
  for (const issue of issues) {
    seen.add(DIMENSION_TO_COARSE[issue.dimension] || issue.dimension);
  }
  return Array.from(seen);
}

export function getDimensionLabels(hotelId: string): string[] {
  const issues = getIssuesForHotel(hotelId);
  const seen = new Set<string>();
  for (const issue of issues) {
    seen.add((issue.dimension_label || issue.dimension).toLowerCase());
  }
  return Array.from(seen);
}
