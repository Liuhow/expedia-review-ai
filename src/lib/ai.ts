import OpenAI from "openai";
import { HttpsProxyAgent } from "https-proxy-agent";
import { HotelRecord, ReviewRecord, FollowUpResponse, DimensionHealth, SuggestedQuestion, DiscoveredDimension, ReviewDimensionTag } from "@/types";

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  console.log("[getClient] API Key exists:", !!apiKey, "Length:", apiKey?.length);
  if (!apiKey) return null;
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const opts: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
  if (proxy) {
    opts.httpAgent = new HttpsProxyAgent(proxy);
  }
  return new OpenAI(opts);
}

function topAmenities(hotel: HotelRecord) {
  return hotel.amenities.slice(0, 5).join(", ");
}

export async function generateHotelSummary(hotel: HotelRecord, reviews: ReviewRecord[]) {
  const client = getClient();
  const sampleReviews = reviews.slice(0, 12).map((review) => review.text).filter(Boolean);

  if (!client || sampleReviews.length === 0) {
    return {
      summary: `Guests often mention ${hotel.city ?? "the property"} for ${topAmenities(hotel) || "its convenient stay experience"}.`,
      highlights: [
        "Use recent guest comments to keep property details current.",
        "Show one concise follow-up while the traveler is already writing.",
        "Keep the experience quick, optional, and easy to complete.",
      ],
    };
  }

  const prompt = `You are helping power a hotel review experience inside Expedia.
Summarize what guests are saying about this property in a product-friendly way.

Hotel:\n${JSON.stringify(hotel, null, 2)}

Recent guest comments:\n${sampleReviews.join("\n---\n")}

Return valid JSON only in this format:
{
  "summary": "1-2 sentence summary",
  "highlights": ["short highlight", "short highlight", "short highlight"]
}`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 1,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No response content");
    return JSON.parse(content);
  } catch (error) {
    console.error("[generateHotelSummary] API Error:", error);
    return {
      summary: `Guests often mention ${hotel.city ?? "the property"} for ${topAmenities(hotel) || "its convenient stay experience"}.`,
      highlights: [
        "Use recent guest comments to keep property details current.",
        "Show one concise follow-up while the traveler is already writing.",
        "Keep the experience quick, optional, and easy to complete.",
      ],
    };
  }
}

export async function generateFollowUp(hotel: HotelRecord, reviews: ReviewRecord[], draftReview: string, focusDimension?: string) {
  const client = getClient();
  const sampleReviews = reviews.slice(0, 18).map((review) => review.text).filter(Boolean);

  const fallback = {
    topic: focusDimension || "breakfast",
    question: focusDimension
      ? `How was the ${focusDimension.toLowerCase()} during your stay?`
      : "Did you try the breakfast during your stay?",
    rationale: focusDimension
      ? `${focusDimension} feedback helps future guests make informed decisions.`
      : "Breakfast is useful for future guests and is not yet covered in your review.",
    quickReplies: ["Great", "Okay", "Poor", "Not sure"],
  };

  if (!client || sampleReviews.length === 0) {
    return fallback;
  }

  const focusInstruction = focusDimension
    ? `\nIMPORTANT: The user wants to provide feedback specifically about "${focusDimension}". Your question MUST be about ${focusDimension} — do NOT ask about a different topic.`
    : "";

  const prompt = `You are generating one low-friction follow-up question for a hotel review flow.

Goal:
- Ask exactly one short follow-up question.
- Base it on this hotel's existing guest comments.
- Avoid repeating topics the current draft review already covers.
- Make the question easy to answer by tap, short text, or voice.
- Keep it natural and product-friendly.${focusInstruction}

Hotel:\n${JSON.stringify(hotel, null, 2)}

Recent guest comments:\n${sampleReviews.join("\n---\n")}

Current draft review:\n${draftReview}

Return valid JSON only in this format:
{
  "topic": "one short topic label",
  "question": "single short question",
  "rationale": "one sentence rationale",
  "quickReplies": ["option 1", "option 2", "option 3", "option 4"]
}`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 1,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No response content");
    const parsed = JSON.parse(content);
    if (!parsed.question || !Array.isArray(parsed.quickReplies)) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

/* ────────────────────────────────────────
   Knowledge Health – Adaptive AI pipeline
   ──────────────────────────────────────── */

function buildPropertyContext(hotel: HotelRecord): string {
  return [
    `Name: ${hotel.name}`,
    hotel.city ? `City: ${hotel.city}` : null,
    hotel.province ? `Province: ${hotel.province}` : null,
    hotel.country ? `Country: ${hotel.country}` : null,
    hotel.starRating ? `Stars: ${hotel.starRating}` : null,
    hotel.description ? `Description: ${hotel.description.slice(0, 400)}` : null,
    hotel.amenities.length > 0 ? `Amenities: ${hotel.amenities.join(", ")}` : null,
  ].filter(Boolean).join("\n");
}

function condensedReviewsJson(reviews: ReviewRecord[], limit = 50): string {
  return JSON.stringify(
    reviews.slice(0, limit).map((r, i) => ({
      i,
      date: r.date,
      text: (r.text ?? "").slice(0, 300),
    })),
  );
}

/* ── Step 1: Dimension Discovery ── */

const DISCOVER_SYSTEM = `You discover and refine normalized hotel review dimensions from review text. Return only strict JSON.`;

function discoverPrompt(propertyCtx: string, reviewsJson: string): string {
  return `You are analyzing hotel reviews for one property.

Your task is to discover the most important review dimensions for this property based on the review text itself.

Goal:
- Infer 8 to 14 dimensions that best describe what guests actually talk about.
- Merge similar topics into one normalized dimension.
- Prefer dimensions that are actionable for a travel review product.
- Include both stable experience dimensions and dynamic / time-sensitive dimensions.
- Avoid dimensions that are too broad, too vague, or duplicated.

Normalization rules:
- Merge synonyms and related phrases under one label.
  Example: "internet", "wifi", "connection" -> "Wi-Fi"
  Example: "front desk", "arrival", "late arrival" -> "Check-in Experience"
- Dimension labels must be concise, user-facing, and title-cased.
- Each dimension must include a short description.
- Each dimension must include 5-12 representative keywords or phrases.
- Assign a staleAfterDays value:
  - 21-30 days for dynamic operational dimensions (breakfast, pool, wifi, check-in, amenities availability, policy clarity)
  - 45-60 days for more stable dimensions (cleanliness, room comfort, service, location)

Property context:
${propertyCtx}

Reviews:
${reviewsJson}

Return strict JSON:
{
  "dimensions": [
    {
      "key": "check_in_experience",
      "label": "Check-in Experience",
      "description": "Guest comments about arrival, front desk process, waiting time, key pickup, and check-in clarity.",
      "keywords": ["check in", "check-in", "front desk", "arrival", "key card", "reception"],
      "staleAfterDays": 30
    }
  ]
}

Rules:
- Return 8 to 14 dimensions only.
- No duplicate dimensions.
- Keywords must be grounded in the review language.`;
}

const DISCOVER_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    dimensions: {
      type: "array" as const,
      items: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          key: { type: "string" as const },
          label: { type: "string" as const },
          description: { type: "string" as const },
          keywords: { type: "array" as const, items: { type: "string" as const } },
          staleAfterDays: { type: "number" as const },
        },
        required: ["key", "label", "description", "keywords", "staleAfterDays"] as const,
      },
    },
  },
  required: ["dimensions"] as const,
};

/** Default fallback dimensions when AI is unavailable */
const FALLBACK_DIMENSIONS: DiscoveredDimension[] = [
  { key: "cleanliness", label: "Cleanliness", description: "Room and bathroom cleanliness.", keywords: ["clean", "dirty", "spotless", "housekeeping", "hygiene", "stain", "dust", "mold"], staleAfterDays: 60 },
  { key: "service", label: "Service", description: "Staff friendliness and helpfulness.", keywords: ["staff", "service", "friendly", "helpful", "rude", "reception", "concierge"], staleAfterDays: 45 },
  { key: "check_in", label: "Check-in Experience", description: "Arrival and front desk process.", keywords: ["check in", "check-in", "front desk", "arrival", "key card", "reception", "queue"], staleAfterDays: 30 },
  { key: "breakfast", label: "Breakfast", description: "Morning meal quality and availability.", keywords: ["breakfast", "buffet", "coffee", "morning meal", "eggs", "continental"], staleAfterDays: 30 },
  { key: "room_comfort", label: "Room Comfort", description: "Bed, AC, noise insulation, and room amenities.", keywords: ["bed", "mattress", "pillow", "comfortable", "air conditioning", "AC", "temperature"], staleAfterDays: 60 },
  { key: "location", label: "Location", description: "Convenience of the hotel's location.", keywords: ["location", "close to", "walking distance", "central", "convenient", "nearby", "transport"], staleAfterDays: 60 },
  { key: "wifi", label: "Wi-Fi", description: "Internet speed and reliability.", keywords: ["wifi", "wi-fi", "internet", "connection", "signal", "network"], staleAfterDays: 30 },
  { key: "value", label: "Value for Money", description: "Whether the price matched the experience.", keywords: ["value", "price", "expensive", "cheap", "worth", "overpriced", "affordable"], staleAfterDays: 45 },
];

export async function discoverDimensions(
  hotel: HotelRecord,
  reviews: ReviewRecord[],
): Promise<DiscoveredDimension[]> {
  const client = getClient();
  if (!client) return FALLBACK_DIMENSIONS;

  const prompt = discoverPrompt(
    buildPropertyContext(hotel),
    condensedReviewsJson(reviews),
  );

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: DISCOVER_SYSTEM },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "discovered_dimensions",
          strict: true,
          schema: DISCOVER_SCHEMA,
        },
      },
      temperature: 1,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No response content");
    const parsed = JSON.parse(content) as { dimensions: DiscoveredDimension[] };
    if (!Array.isArray(parsed.dimensions) || parsed.dimensions.length === 0) {
      return FALLBACK_DIMENSIONS;
    }
    return parsed.dimensions.slice(0, 14);
  } catch {
    return FALLBACK_DIMENSIONS;
  }
}

/* ── Step 2: Review-to-Dimension Tagging ── */

function tagPrompt(dimensionsJson: string, reviewsJson: string): string {
  return `You are tagging hotel reviews into normalized dimensions.

You will receive:
1. A list of dimensions
2. A batch of reviews

For each review:
- assign 0 to 3 relevant dimensions
- classify sentiment for each assigned dimension as positive, negative, mixed, or neutral
- extract a short evidence phrase

Dimension list:
${dimensionsJson}

Reviews:
${reviewsJson}

Return strict JSON:
{
  "reviewTags": [
    {
      "reviewIndex": 0,
      "dimensions": [
        {
          "key": "breakfast",
          "sentiment": "negative",
          "evidence": "breakfast options were limited"
        }
      ]
    }
  ]
}

Rules:
- Only assign dimensions clearly supported by the review text.
- Do not force every review into a dimension.
- Keep evidence short and verbatim-ish.`;
}

const TAG_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    reviewTags: {
      type: "array" as const,
      items: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          reviewIndex: { type: "number" as const },
          dimensions: {
            type: "array" as const,
            items: {
              type: "object" as const,
              additionalProperties: false,
              properties: {
                key: { type: "string" as const },
                sentiment: { type: "string" as const, enum: ["positive", "negative", "mixed", "neutral"] },
                evidence: { type: "string" as const },
              },
              required: ["key", "sentiment", "evidence"] as const,
            },
          },
        },
        required: ["reviewIndex", "dimensions"] as const,
      },
    },
  },
  required: ["reviewTags"] as const,
};

export async function tagReviewsDimensions(
  dimensions: DiscoveredDimension[],
  reviews: ReviewRecord[],
): Promise<ReviewDimensionTag[]> {
  const client = getClient();
  if (!client) return [];

  const dimJson = JSON.stringify(
    dimensions.map((d) => ({ key: d.key, label: d.label, keywords: d.keywords })),
  );

  // Process in batches of 30
  const BATCH = 30;
  const allTags: ReviewDimensionTag[] = [];

  for (let start = 0; start < reviews.length; start += BATCH) {
    const batch = reviews.slice(start, start + BATCH);
    const batchJson = JSON.stringify(
      batch.map((r, i) => ({ i: start + i, date: r.date, text: (r.text ?? "").slice(0, 300) })),
    );

    try {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You tag hotel reviews into dimensions with sentiment. Return only strict JSON." },
          { role: "user", content: tagPrompt(dimJson, batchJson) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "review_dimension_tags",
            strict: true,
            schema: TAG_SCHEMA,
          },
        },
        temperature: 1,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("No response content");
      const parsed = JSON.parse(content) as { reviewTags: ReviewDimensionTag[] };
      if (Array.isArray(parsed.reviewTags)) {
        allTags.push(...parsed.reviewTags);
      }
    } catch {
      // continue with next batch
    }
  }

  return allTags;
}

/* ── Step 3: Question Generation ── */

interface RefineHealthInput {
  hotel: HotelRecord;
  reviews: ReviewRecord[];
  cards: DimensionHealth[];
  fallbackQuestions: SuggestedQuestion[];
  maxQuestions: number;
  dimensionKeys: string[];
}

interface RefineHealthResult {
  questions: SuggestedQuestion[];
  aiSummary: string;
}

export async function refineHealthWithAI(params: RefineHealthInput): Promise<RefineHealthResult> {
  const { hotel, reviews, cards, fallbackQuestions, maxQuestions } = params;
  const client = getClient();

  const fallbackResult: RefineHealthResult = {
    questions: fallbackQuestions,
    aiSummary: "AI refinement skipped because OPENAI_API_KEY is not configured.",
  };

  if (!client) return fallbackResult;

  const condensedReviews = reviews.slice(0, 40).map((r) => ({
    date: r.date,
    title: (r.title ?? "").slice(0, 120),
    text: (r.text ?? "").slice(0, 280),
  }));

  const promptPayload = {
    property: {
      id: hotel.id,
      name: hotel.name,
      city: hotel.city,
      country: hotel.country,
      starRating: hotel.starRating,
      description: hotel.description.slice(0, 500),
      amenities: hotel.amenities,
    },
    healthCards: cards,
    fallbackQuestions,
    recentReviews: condensedReviews,
    task: {
      goal: "Select the best 1-2 low-friction follow-up questions that fill missing or stale property information.",
      constraints: [
        "Ask at most the requested number of questions.",
        "Prefer dimensions that are stale, unknown, risky, or important for future travelers.",
        "Keep questions conversational, specific, and easy to answer.",
      ],
      maxQuestions,
    },
  };

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an Expedia review intelligence assistant. Choose the best follow-up questions to refresh missing or outdated property knowledge. Return only structured JSON.",
        },
        {
          role: "user",
          content: JSON.stringify(promptPayload),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "review_gap_questions",
          strict: true,
          schema: {
            type: "object" as const,
            additionalProperties: false,
            properties: {
              aiSummary: { type: "string" as const },
              questions: {
                type: "array" as const,
                items: {
                  type: "object" as const,
                  additionalProperties: false,
                  properties: {
                    dimension: { type: "string" as const },
                    question: { type: "string" as const },
                    why: { type: "string" as const },
                    answerType: { type: "string" as const, enum: ["text", "yes_no", "choice"] },
                    priority: { type: "number" as const },
                  },
                  required: ["dimension", "question", "why", "answerType", "priority"] as const,
                },
              },
            },
            required: ["aiSummary", "questions"] as const,
          },
        },
      },
      temperature: 1,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No response content");
    const parsed = JSON.parse(content) as RefineHealthResult;
    if (!Array.isArray(parsed.questions)) return fallbackResult;
    return parsed;
  } catch {
    return fallbackResult;
  }
}
