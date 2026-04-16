import type { FollowUpResponse, PipelineIssue } from "@/types";
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

/* ───── Aspect chips per coarse topic: positive & negative ───── */

const ASPECT_CHIPS_POS: Record<string, string[]> = {
  room: ["Spacious", "Clean", "Comfortable bed", "Quiet", "Nice view", "Good AC"],
  service: ["Friendly staff", "Quick response", "Helpful concierge", "Smooth check-in", "Attentive", "Professional"],
  breakfast: ["Good variety", "Fresh food", "Nice setting", "Quick service", "Local options", "Kid-friendly"],
  pool: ["Clean water", "Good size", "Nice loungers", "Well-maintained", "Not crowded", "Good for kids"],
  parking: ["Easy to find", "Affordable", "Secure", "Close to entrance", "Spacious spots", "Well-lit"],
  location: ["Near attractions", "Quiet area", "Good restaurants nearby", "Easy transport", "Safe neighborhood", "Walkable"],
  wifi: ["Fast speed", "Reliable", "Good in room", "Free", "Easy to connect", "Strong signal"],
  facilities: ["Well-equipped gym", "Nice spa", "Clean", "Modern", "Well-maintained", "Good hours"],
  dining: ["Tasty food", "Good variety", "Nice ambiance", "Reasonable prices", "Quick service", "Fresh ingredients"],
};

const ASPECT_CHIPS_NEG: Record<string, string[]> = {
  room: ["Too small", "Not clean", "Uncomfortable bed", "Noisy", "Bad view", "Poor AC"],
  service: ["Slow response", "Unfriendly", "Unhelpful", "Long check-in wait", "Inattentive", "Unprofessional"],
  breakfast: ["Limited options", "Not fresh", "Crowded", "Slow service", "Repetitive", "Overpriced"],
  pool: ["Dirty water", "Too small", "No loungers", "Poorly maintained", "Too crowded", "Unsafe for kids"],
  parking: ["Hard to find", "Expensive", "Not secure", "Far from entrance", "Tight spaces", "Poorly lit"],
  location: ["Far from attractions", "Noisy area", "Few restaurants", "Bad transport", "Unsafe feeling", "Not walkable"],
  wifi: ["Slow speed", "Unreliable", "Weak in room", "Not free", "Hard to connect", "Keeps dropping"],
  facilities: ["Outdated gym", "Poor spa", "Not clean", "Old equipment", "Poorly maintained", "Limited hours"],
  dining: ["Bland food", "Limited menu", "Bad ambiance", "Overpriced", "Slow service", "Not fresh"],
};

/* ───── Sentiment detection ───── */

type Sentiment = "positive" | "negative" | "neutral";

const POS_WORDS = ["great", "good", "nice", "love", "loved", "amazing", "excellent", "wonderful", "fantastic", "perfect", "beautiful", "clean", "comfortable", "friendly", "helpful", "best", "enjoyed", "spacious", "recommend", "happy", "pleasant", "awesome", "incredible", "superb", "delicious", "cozy", "quiet", "convenient"];
const NEG_WORDS = ["bad", "terrible", "awful", "dirty", "noisy", "rude", "slow", "small", "uncomfortable", "disappointing", "worst", "horrible", "poor", "broken", "old", "cold", "hot", "smelly", "crowded", "overpriced", "expensive", "unfriendly", "disgusting", "stained", "moldy", "bugs", "cockroach", "loud", "tiny"];

function detectSentiment(draftReview: string, rating: number = 0): Sentiment {
  // Rating is 0-10 scale (even: 2,4,6,8,10)
  if (rating >= 8 && !draftReview.trim()) return "positive";
  if (rating <= 4 && rating > 0 && !draftReview.trim()) return "negative";

  const lower = draftReview.toLowerCase();
  // Focus on last sentence for current sentiment
  const sentences = lower.split(/[.!?]+/).filter(Boolean);
  const lastPart = sentences.length > 0 ? sentences[sentences.length - 1] : lower;

  let posCount = POS_WORDS.filter((w) => lastPart.includes(w)).length;
  let negCount = NEG_WORDS.filter((w) => lastPart.includes(w)).length;

  // Rating biases the sentiment: adds 1 virtual vote
  if (rating >= 4) posCount += 1;
  else if (rating <= 2 && rating > 0) negCount += 1;

  if (posCount > negCount) return "positive";
  if (negCount > posCount) return "negative";

  // If text is neutral, fall back to rating
  if (rating >= 4) return "positive";
  if (rating <= 2 && rating > 0) return "negative";
  return "neutral";
}

/** Returns { quickReplies, negativeChips } for spreading into a result object. */
function getChipsFields(coarseTopic: string, sentiment: Sentiment = "neutral"): { quickReplies: string[]; negativeChips: string[] } {
  const { chips, negSet } = getAspectChipsRaw(coarseTopic, sentiment);
  return { quickReplies: chips, negativeChips: negSet };
}

function getAspectChipsRaw(coarseTopic: string, sentiment: Sentiment = "neutral"): { chips: string[]; negSet: string[] } {
  const pos = ASPECT_CHIPS_POS[coarseTopic] ?? ["Spacious", "Clean", "Comfortable", "Well-maintained", "Convenient", "Good value"];
  const neg = ASPECT_CHIPS_NEG[coarseTopic] ?? ["Too small", "Not clean", "Uncomfortable", "Poorly maintained", "Inconvenient", "Overpriced"];

  let chips: string[];
  let negSet: string[];
  if (sentiment === "positive") {
    chips = [...pos.slice(0, 4), ...neg.slice(0, 2)];
    negSet = neg.slice(0, 2);
  } else if (sentiment === "negative") {
    chips = [...pos.slice(0, 2), ...neg.slice(0, 4)];
    negSet = neg.slice(0, 4);
  } else {
    chips = [...pos.slice(0, 3), ...neg.slice(0, 3)];
    negSet = neg.slice(0, 3);
  }
  return { chips, negSet };
}

/* ───── Detect what topic user is currently writing about ───── */

// Topic keywords — only nouns/objects, NO sentiment adjectives (good/bad/clean/quiet etc.)
const TOPIC_DETECT_KEYWORDS: Record<string, string[]> = {
  room: ["room", "bed", "mattress", "pillow", "bathroom", "shower", "toilet", "bathtub", "sink", "view", "balcony", "AC", "air conditioning", "decor", "renovation", "suite", "closet", "mini-bar", "minibar"],
  service: ["staff", "service", "check-in", "checkin", "front desk", "reception", "concierge", "housekeeping", "bellman", "porter"],
  breakfast: ["breakfast", "buffet", "morning meal", "coffee", "eggs", "pastry", "cereal", "omelette"],
  pool: ["pool", "swimming", "lounger", "jacuzzi", "hot tub", "waterslide"],
  parking: ["parking", "garage", "car", "valet"],
  location: ["location", "area", "neighborhood", "transport", "walk", "nearby", "downtown", "beach", "station", "airport"],
  wifi: ["wifi", "wi-fi", "internet", "connection", "signal"],
  facilities: ["gym", "spa", "fitness", "elevator", "lobby", "laundry", "amenities", "sauna"],
  dining: ["restaurant", "bar", "food", "dinner", "lunch", "dining", "menu", "meal", "cuisine"],
};

function detectDraftTopic(draftLower: string): string | null {
  // Find which topic the user is CURRENTLY writing about (last sentence matters most)
  const sentences = draftLower.split(/[.!?]+/).filter(Boolean);
  const lastPart = sentences.length > 0 ? sentences[sentences.length - 1] : draftLower;

  let bestTopic: string | null = null;
  let bestScore = 0;

  for (const [topic, keywords] of Object.entries(TOPIC_DETECT_KEYWORDS)) {
    const score = keywords.filter((kw) => lastPart.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  return bestTopic;
}

function getAllCoveredTopics(draftLower: string): Set<string> {
  const covered = new Set<string>();
  for (const [topic, keywords] of Object.entries(TOPIC_DETECT_KEYWORDS)) {
    if (keywords.some((kw) => draftLower.includes(kw))) {
      covered.add(topic);
    }
  }
  return covered;
}

/* ───── Build question ───── */

function buildQuestion(coarseTopic: string, isDeepen: boolean, draftReview?: string): string {
  if (isDeepen) {
    // Detect sentiment from last sentence to ask a targeted follow-up
    const lower = (draftReview || "").toLowerCase();
    const sentences = lower.split(/[.!?]+/).filter(Boolean);
    const lastPart = sentences.length > 0 ? sentences[sentences.length - 1] : lower;
    const isNeg = NEG_WORDS.some((w) => lastPart.includes(w));
    const isPos = POS_WORDS.some((w) => lastPart.includes(w));

    // Negative-specific drill-downs — easy to answer with chips
    if (isNeg) {
      const negDeepen: Record<string, string> = {
        room: "What was the main issue with the room?",
        service: "What went wrong with the service?",
        breakfast: "What was the issue with breakfast?",
        pool: "What was the issue with the pool?",
        parking: "What was the parking problem?",
        location: "What didn't work about the location?",
        wifi: "How did the WiFi fall short?",
        facilities: "What was the issue with the facilities?",
        dining: "What was the issue with the dining?",
      };
      return negDeepen[coarseTopic] ?? `What was the main issue with the ${coarseTopic}?`;
    }
    // Positive-specific drill-downs — easy to answer with chips
    if (isPos) {
      const posDeepen: Record<string, string> = {
        room: "What stood out about the room?",
        service: "What made the service stand out?",
        breakfast: "What made breakfast stand out?",
        pool: "What did you enjoy about the pool?",
        parking: "What made parking easy?",
        location: "What's great about the location?",
        wifi: "Was it fast enough for work or streaming?",
        facilities: "Which facilities stood out?",
        dining: "What stood out about the dining?",
      };
      return posDeepen[coarseTopic] ?? `What stood out about the ${coarseTopic}?`;
    }
    // Neutral — rate/evaluate style, easy to answer
    const neutralDeepen: Record<string, string> = {
      room: "How would you rate the room overall?",
      service: "How would you rate the staff and service?",
      breakfast: "How would you rate the breakfast?",
      pool: "How was the pool area?",
      parking: "How was the parking situation?",
      location: "How convenient was the location?",
      wifi: "How was the WiFi speed and reliability?",
      facilities: "How were the hotel facilities?",
      dining: "How was the food and dining experience?",
    };
    return neutralDeepen[coarseTopic] ?? `How would you rate the ${coarseTopic}?`;
  }
  // User hasn't mentioned this — gently introduce it
  return `How was the ${coarseTopic}?`;
}

function buildRationale(coarseTopic: string, isDeepen: boolean): string {
  if (isDeepen) return "";
  return "Few guests mentioned this — your input is valuable.";
}

/* ───── Main exports ───── */

export interface PipelineFollowUpResult extends FollowUpResponse {
  _pipelineDimension?: string;
  _issueType?: string;
  _evidence?: string;
  _isMultiSelect?: boolean;
}

/**
 * Initial follow-ups (empty state). Max 2.
 * Uses specific dimension labels (e.g. "bathroom", "bed and sleep quality")
 * instead of coarse topics (e.g. "room") for more targeted questions.
 */
export function getInitialFollowUps(
  hotelId: string,
  limit: number = 2,
  rating: number = 0,
): PipelineFollowUpResult[] {
  const issues = getIssuesForHotel(hotelId);
  if (issues.length === 0) return [];

  const sentiment = detectSentiment("", rating);
  const results: PipelineFollowUpResult[] = [];
  const usedDimensions = new Set<string>();

  for (const issue of issues) {
    const dim = issue.dimension;
    if (usedDimensions.has(dim)) continue;
    usedDimensions.add(dim);

    const coarse = DIMENSION_TO_COARSE[dim] || dim;
    const label = issue.dimension_label || dim;

    results.push({
      topic: coarse,
      question: `How was the ${label}?`,
      rationale: buildRationale(coarse, false),
      ...getChipsFields(coarse, sentiment),
      _pipelineDimension: dim,
      _issueType: issue.issue_type,
      _evidence: issue.evidence_a,
      _isMultiSelect: true,
    });

    if (results.length >= limit) break;
  }

  return results;
}

/**
 * Draft-mode follow-up (instant, no LLM call).
 * Strategy:
 *  1. Detect what topic the user is currently writing about
 *  2. If they're writing about a pipeline issue topic → deepen it (ask for specifics)
 *  3. If not → find highest-priority uncovered pipeline issue
 */
export function buildFollowUpFromPipeline(
  hotelId: string,
  draftReview: string,
  focusDimension?: string,
  rating: number = 0,
  answeredTopics: string[] = [],
): PipelineFollowUpResult | null {
  const issues = getIssuesForHotel(hotelId);
  if (issues.length === 0) return null;

  const draftLower = draftReview.toLowerCase();
  const coveredTopics = getAllCoveredTopics(draftLower);
  const currentTopic = detectDraftTopic(draftLower);
  const sentiment = detectSentiment(draftReview, rating);
  // Build expanded answered set: include related topics (e.g. "dining" → also skip "breakfast", "restaurant")
  const answeredSet = new Set(answeredTopics.map((t) => t.toLowerCase()));
  // Add reverse mappings: if "dining" is answered, also mark "breakfast", "restaurant" etc.
  for (const at of answeredTopics) {
    const atLower = at.toLowerCase();
    // Find all TOPIC_DETECT_KEYWORDS entries whose keywords overlap with answered topic
    for (const [topic, keywords] of Object.entries(TOPIC_DETECT_KEYWORDS)) {
      if (topic === atLower || keywords.some((kw) => kw === atLower || atLower.includes(kw) || kw.includes(atLower))) {
        answeredSet.add(topic);
      }
    }
    // Also mark dimensions that map to this coarse topic
    for (const [dim, coarse] of Object.entries(DIMENSION_TO_COARSE)) {
      if (coarse === atLower) answeredSet.add(dim);
    }
  }

  // Strategy 1: If user is writing about a topic that matches a pipeline issue → deepen it
  // Skip if this topic was already answered
  if (currentTopic && !answeredSet.has(currentTopic)) {
    const matchingIssue = issues.find((i) => {
      const coarse = DIMENSION_TO_COARSE[i.dimension] || i.dimension_label || i.dimension;
      return coarse === currentTopic;
    });
    if (matchingIssue) {
      return {
        topic: currentTopic,
        question: buildQuestion(currentTopic, true, draftReview),
        rationale: buildRationale(currentTopic, true),
        ...getChipsFields(currentTopic, sentiment),
        _pipelineDimension: matchingIssue.dimension,
        _issueType: matchingIssue.issue_type,
        _evidence: matchingIssue.evidence_a,
        _isMultiSelect: true,
      };
    }
    // Topic detected but no matching pipeline issue → return null
    // so LLM fallback can semantically match (e.g. "breakfast" → "restaurant")
    return null;
  }

  // If user typed something meaningful but keywords didn't match → let LLM handle it
  // Only fall to Strategy 2 when input is very short/empty (no clear topic to match)
  const lastSentence = draftLower.split(/[.!?]+/).filter(Boolean).pop()?.trim() || "";
  if (lastSentence.length >= 3 && !currentTopic) {
    return null; // let LLM semantically match
  }

  // Strategy 2: No specific topic detected → find highest-priority uncovered issue
  // Skip topics already answered
  const uncoveredIssue = issues.find((i) => {
    const coarse = DIMENSION_TO_COARSE[i.dimension] || i.dimension_label || i.dimension;
    return !coveredTopics.has(coarse) && !answeredSet.has(coarse);
  });

  if (uncoveredIssue) {
    const coarse = DIMENSION_TO_COARSE[uncoveredIssue.dimension] || uncoveredIssue.dimension;
    const label = uncoveredIssue.dimension_label || uncoveredIssue.dimension;
    return {
      topic: coarse,
      question: `How was the ${label}?`,
      rationale: buildRationale(coarse, false),
      ...getChipsFields(coarse, sentiment),
      _pipelineDimension: uncoveredIssue.dimension,
      _issueType: uncoveredIssue.issue_type,
      _evidence: uncoveredIssue.evidence_a,
      _isMultiSelect: true,
    };
  }

  return null; // all topics covered
}

/**
 * Get all coarse topics available for a hotel (for LLM topic detection).
 */
export function getCoarseTopics(hotelId: string): string[] {
  const issues = getIssuesForHotel(hotelId);
  const seen = new Set<string>();
  for (const issue of issues) {
    const coarse = DIMENSION_TO_COARSE[issue.dimension] || issue.dimension_label || issue.dimension;
    seen.add(coarse);
  }
  return Array.from(seen);
}

/**
 * Get all unique dimension labels for a hotel (for LLM dimension-level matching).
 * Returns labels like "restaurant", "bathroom", "Wi-Fi" etc.
 */
export function getDimensionLabels(hotelId: string): string[] {
  const issues = getIssuesForHotel(hotelId);
  const seen = new Set<string>();
  for (const issue of issues) {
    const label = (issue.dimension_label || issue.dimension).toLowerCase();
    seen.add(label);
  }
  return Array.from(seen);
}

/**
 * Build a follow-up for a specific dimension label (used after LLM dimension matching).
 * Matches against dimension_label (e.g. "restaurant") rather than coarse topic.
 */
export function buildFollowUpForDimension(
  hotelId: string,
  dimensionLabel: string,
  draftReview: string,
  rating: number = 0,
): PipelineFollowUpResult | null {
  const issues = getIssuesForHotel(hotelId);
  const sentiment = detectSentiment(draftReview, rating);

  const matchingIssue = issues.find((i) => {
    const label = (i.dimension_label || i.dimension).toLowerCase();
    return label === dimensionLabel.toLowerCase();
  });

  if (matchingIssue) {
    const coarse = DIMENSION_TO_COARSE[matchingIssue.dimension] || matchingIssue.dimension;
    const label = matchingIssue.dimension_label || matchingIssue.dimension;
    const question = buildQuestionForLabel(label, draftReview);
    // Use user's topic for chips if available (e.g. "breakfast" chips instead of "dining" chips)
    const userTopic = extractUserTopic((draftReview || "").toLowerCase());
    const chipsKey = (userTopic && ASPECT_CHIPS_POS[userTopic]) ? userTopic : coarse;
    return {
      topic: coarse,
      question,
      rationale: buildRationale(coarse, true),
      ...getChipsFields(chipsKey, sentiment),
      _pipelineDimension: matchingIssue.dimension,
      _issueType: matchingIssue.issue_type,
      _evidence: matchingIssue.evidence_a,
      _isMultiSelect: true,
    };
  }

  return null;
}

/**
 * Build a question using the user's own words when possible.
 * E.g. user types "breakfast" matched to "restaurant" dimension → ask about "breakfast", not "restaurant".
 */
function buildQuestionForLabel(dimensionLabel: string, draftReview?: string): string {
  const lower = (draftReview || "").toLowerCase();
  const sentences = lower.split(/[.!?]+/).filter(Boolean);
  const lastPart = sentences.length > 0 ? sentences[sentences.length - 1] : lower;
  const isNeg = NEG_WORDS.some((w) => lastPart.includes(w));
  const isPos = POS_WORDS.some((w) => lastPart.includes(w));

  // Extract what the user actually mentioned — use their word, not the dimension label
  // e.g. user wrote "breakfast" but matched to "restaurant" → use "breakfast"
  const userTopic = extractUserTopic(lastPart) || dimensionLabel;

  if (isNeg) return `What was the issue with the ${userTopic}?`;
  if (isPos) return `What stood out about the ${userTopic}?`;
  return `How would you rate the ${userTopic}?`;
}

/** Extract the most specific noun/topic the user mentioned in their text. */
function extractUserTopic(text: string): string | null {
  // Check all keyword lists — return the most specific keyword found in user's text
  const allKeywords: Array<{ word: string; topic: string }> = [];
  for (const [topic, keywords] of Object.entries(TOPIC_DETECT_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        allKeywords.push({ word: kw, topic });
      }
    }
  }
  if (allKeywords.length === 0) return null;
  // Prefer the longest (most specific) keyword match
  allKeywords.sort((a, b) => b.word.length - a.word.length);
  return allKeywords[0].word;
}

/**
 * Build a follow-up for a specific coarse topic (used after LLM detection).
 */
export function buildFollowUpForTopic(
  hotelId: string,
  coarseTopic: string,
  draftReview: string,
  rating: number = 0,
): PipelineFollowUpResult | null {
  const issues = getIssuesForHotel(hotelId);
  const draftLower = draftReview.toLowerCase();
  const coveredTopics = getAllCoveredTopics(draftLower);
  const sentiment = detectSentiment(draftReview, rating);

  // Check if user is already writing about this topic
  const isDeepen = coveredTopics.has(coarseTopic);

  const matchingIssue = issues.find((i) => {
    const coarse = DIMENSION_TO_COARSE[i.dimension] || i.dimension_label || i.dimension;
    return coarse === coarseTopic;
  });

  if (matchingIssue) {
    const label = matchingIssue.dimension_label || matchingIssue.dimension;
    return {
      topic: coarseTopic,
      question: isDeepen
        ? buildQuestion(coarseTopic, true, draftReview)
        : `How was the ${label}?`,
      rationale: buildRationale(coarseTopic, isDeepen),
      ...getChipsFields(coarseTopic, sentiment),
      _pipelineDimension: matchingIssue.dimension,
      _issueType: matchingIssue.issue_type,
      _evidence: matchingIssue.evidence_a,
      _isMultiSelect: true,
    };
  }

  return null;
}

/* ───── General fallback questions (no pipeline match) ───── */

const GENERAL_POS_CHIPS = ["Room", "Service", "Location", "Food", "Amenities", "Value"];
const GENERAL_NEG_CHIPS = ["Cleanliness", "Service speed", "Food quality", "Noise", "Maintenance", "WiFi"];

const GENERAL_QUESTIONS: Array<{
  topic: string;
  question: string;
  posChips: string[];
  negChips: string[];
}> = [
  {
    topic: "overall",
    question: "What stood out during your stay?",
    posChips: ["Great room", "Friendly staff", "Perfect location", "Delicious food", "Good amenities", "Great value"],
    negChips: ["Room issues", "Poor service", "Bad location", "Disappointing food", "Lacking amenities", "Overpriced"],
  },
  {
    topic: "recommendation",
    question: "Who would you recommend this hotel to?",
    posChips: ["Families", "Couples", "Solo travelers", "Business", "Budget travelers", "Groups"],
    negChips: ["Families", "Couples", "Solo travelers", "Business", "Budget travelers", "Groups"],
  },
  {
    topic: "improvement",
    question: "Anything the hotel could improve?",
    posChips: ["Minor details", "More options", "Better hours", "Small upgrades", "Nothing major", "WiFi speed"],
    negChips: ["Cleanliness", "Service speed", "Food quality", "Noise control", "Maintenance", "WiFi"],
  },
];

/**
 * Get a general follow-up question when no pipeline topic matches.
 */
export function getGeneralFollowUp(draftReview: string, rating: number = 0): PipelineFollowUpResult | null {
  const draftLower = draftReview.toLowerCase();
  const sentiment = detectSentiment(draftReview, rating);

  // Pick a general question that isn't already covered by draft content
  for (const q of GENERAL_QUESTIONS) {
    if (q.topic === "overall" && draftLower.length > 100) continue;
    if (q.topic === "recommendation" && (draftLower.includes("recommend") || draftLower.includes("perfect for"))) continue;
    if (q.topic === "improvement" && (draftLower.includes("improve") || draftLower.includes("could be better") || draftLower.includes("issue"))) continue;

    let chips: string[];
    if (sentiment === "positive") {
      chips = [...q.posChips.slice(0, 4), ...q.negChips.slice(0, 2)];
    } else if (sentiment === "negative") {
      chips = [...q.posChips.slice(0, 2), ...q.negChips.slice(0, 4)];
    } else {
      chips = [...q.posChips.slice(0, 3), ...q.negChips.slice(0, 3)];
    }

    return {
      topic: q.topic,
      question: q.question,
      rationale: "",
      quickReplies: chips,
      _isMultiSelect: true,
    };
  }

  return null;
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
