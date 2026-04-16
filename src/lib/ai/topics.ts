import { ReviewTopic } from "@/types/ai";

export const TOPIC_KEYWORDS: Record<ReviewTopic, string[]> = {
  cleanliness: ["clean", "cleanliness", "dirty", "spotless", "messy", "tidy"],
  service: ["staff", "service", "friendly", "helpful", "rude", "front desk"],
  breakfast: ["breakfast", "buffet", "morning meal", "continental breakfast"],
  pool: ["pool", "swimming", "hot tub"],
  parking: ["parking", "garage", "parked", "valet"],
  location: ["location", "near", "close to", "airport", "downtown", "beach"],
  noise: ["noise", "noisy", "quiet", "loud", "soundproof"],
  amenities: ["amenities", "gym", "spa", "facility", "facilities"],
  check_in: ["check-in", "check in", "front desk", "arrival"],
  check_out: ["check-out", "check out", "departure"],
  room_condition: ["room", "bed", "bathroom", "shower", "mattress", "furniture"],
  wifi: ["wifi", "wi-fi", "internet"],
  family_friendly: ["family", "kids", "children", "child-friendly"],
  pet_friendly: ["pet", "dog", "cat", "pet-friendly"],
  safety: ["safe", "safety", "secure", "security"],
};

export const ALL_TOPICS = Object.keys(TOPIC_KEYWORDS) as ReviewTopic[];

export function extractTopicsFromText(text: string | null | undefined): ReviewTopic[] {
  if (!text) return [];
  const lower = text.toLowerCase();

  return ALL_TOPICS.filter((topic) =>
    TOPIC_KEYWORDS[topic].some((kw) => lower.includes(kw.toLowerCase()))
  );
}
