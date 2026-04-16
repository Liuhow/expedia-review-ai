export type ReviewTopic =
  | "cleanliness"
  | "service"
  | "breakfast"
  | "pool"
  | "parking"
  | "location"
  | "noise"
  | "amenities"
  | "check_in"
  | "check_out"
  | "room_condition"
  | "wifi"
  | "family_friendly"
  | "pet_friendly"
  | "safety";

export interface ReviewRecord {
  property_id: string;
  acquisition_date: string;
  review_title?: string | null;
  review_text?: string | null;
  rating?: number | null;
}

export interface PropertyContext {
  property_id: string;
  property_name: string;
  city?: string;
  province?: string;
  country?: string;
  property_description?: string;
  popular_amenities_list?: string;
  check_in_instructions?: string;
  pet_policy?: string;
  know_before_you_go?: string;
}

export interface TopicCoverageStats {
  topic: ReviewTopic;
  mentionCountTotal: number;
  mentionCount30d: number;
  mentionCount90d: number;
  mentionRate90d: number;
  daysSinceLastMention: number | null;
  recentWeightedScore: number;
}

export interface GapCandidate {
  topic: ReviewTopic;
  priorityScore: number;
  reason: string;
  stats: TopicCoverageStats;
}

export interface GapDetectionOutput {
  selected_topic: ReviewTopic | null;
  reason: string;
  confidence: number;
  covered_topics: ReviewTopic[];
  candidates: GapCandidate[];
}

export interface FollowUpOutput {
  question: string;
  quick_replies: string[];
}

export interface StructuredInsightOutput {
  sentiment: "positive" | "neutral" | "negative" | "mixed";
  insight: string;
}
