"""
Expedia Hotel Review Analysis Pipeline
=======================================

AI Calls (~4,372 total):
  Step 1  [  1 call ] Classify dimensions → time_sensitive (for 4d)
  Step 2  [ 13 calls] AI facility mapping per hotel
  Step 3  [4258 calls] Per-review analysis — 5 tasks in 1 call:
               Task 1: Quality Score (1-5)
               Task 2: Dimension Classification
               Task 3: Unlisted Facilities (review says hotel HAS, info doesn't)
               Task 4: Info Conflict 4a (permanent: hotel info vs review)
               Task 5: Temporary Events 4c (breakdown/closure/seasonal)
  Step 4  [~100 calls] 4b contradiction detection per hotel-dimension pair

Pure Computation (0 LLM calls):
  Gap Detection    — coverage gap: mention rate < 5% in high-quality reviews
  4c Event Tracking— RESOLVED/ONGOING/UNKNOWN/TOO_EARLY per event
  Staleness 4d     — time stale: latest HQ review > threshold days
  Priority Scoring — 0-100 score per issue (grounded in Expedia kickoff transcript)

Excel Output (13 sheets):
   1. Reviews Analyzed      full results per review
   2. Quality Summary       avg quality score per hotel
   3. Dimension Coverage    mention rate + is_gap per hotel × dimension
   4. Unlisted Facilities   positively mentioned but not in hotel info
   5. Wording Mismatch      same facility, different wording
   6. Info Conflicts (4a)   permanent conflicts: hotel info vs review
   7. Temp Events (4c)      temporary events + relevance (high/medium/low)
   8. Event Tracking (4c)   RESOLVED/ONGOING/UNKNOWN/TOO_EARLY per event
   9. Time Stale (4d)       dimensions not reviewed for 12+ months
  10. Contradictions (4b)   STALE/POTENTIAL cross-review contradictions
  11. Unmapped Amenities    AI could not map amenity to any dimension
  12. Question Input        priority-scored issues (pipeline → frontend contract)
  13. Review Labels         STALE/FRESH labels for frontend display

JSON Output (frontend static data):
  data/issues.json         top-3 prioritised issues per hotel (for reviewer prompts)
  data/hotels.json         hotel summary cards
  data/review_labels.json  stale/fresh labels per hotel
"""

# ═══════════════════════════════════════════════════════════════
# IMPORTS & CONFIG
# ═══════════════════════════════════════════════════════════════

import os
import re
import json
import math
import time
import pandas as pd
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from openai import OpenAI
from deep_translator import GoogleTranslator
from langdetect import detect, LangDetectException

# ── API Config ────────────────────────────────────────────────

# Paste your OpenAI API key here, or set OPENAI_API_KEY env var
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

# Resolve paths relative to this script's directory
_SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR     = os.path.join(_SCRIPT_DIR, "data")

REVIEWS_PATH  = os.path.join(_DATA_DIR, "Reviews_PROC.csv")
DESC_PATH     = os.path.join(_DATA_DIR, "Description_PROC.csv")
CLEAN_CSV     = os.path.join(_DATA_DIR, "reviews_clean.csv")
OUTPUT_PATH   = os.path.join(_SCRIPT_DIR, "reviews_analyzed.xlsx")

MODEL             = "gpt-4o-mini"
SLEEP_BETWEEN     = 0.1    # reduced: parallel calls spread the load
STALE_THRESHOLD   = 365   # days for 4d time stale
MAX_WORKERS       = 5     # parallel review analysis threads

client = OpenAI(
    api_key=OPENAI_API_KEY,
    timeout=60,
)

# ═══════════════════════════════════════════════════════════════
# DIMENSION DEFINITIONS (single source of truth)
# ═══════════════════════════════════════════════════════════════

# Core dimensions — always apply to all hotels
CORE_DIMENSIONS = """  - bed_comfort        (bed, mattress, pillow, sleep quality)
  - room_noise         (soundproofing, noise from neighbors/street)
  - room_size          (space, cramped, spacious)
  - smell              (odor, mustiness, freshness)
  - room_view          (scenery, window view)
  - room_cleanliness   (cleanliness, dust, stains, hygiene)
  - bathroom           (shower, hot water, water pressure, bathtub)
  - staff_attitude     (friendliness, helpfulness, professionalism)
  - checkin_experience (check-in, check-out, front desk, arrival)
  - decor_renovation   (condition, age, renovation, design)
  - lobby              (common areas, entrance, public spaces)
  - value_for_money    (price, cost, worth it, expensive/cheap)
  - location           (area, transport links, walkability, nearby)"""

# Facility dimensions — hotel-specific, mapped by AI from amenities list
# This is the standard name table used by ALL facility-related AI calls:
#   - Facility mapping   (hotel amenities → standard names)
#   - Unlisted facility  (review mentions → same standard names)
#   - 4a conflict        (hotel info vs review, same namespace)
AVAILABLE_FACILITY_DIMS = """  - pool           (swimming pool, lap pool, outdoor/indoor pool)
  - kids_pool      (children's pool, splash area, kids water area)
  - hot_tub        (hot tub, jacuzzi, whirlpool)
  - gym_fitness    (gym, fitness center, treadmill, weights, workout room)
  - spa            (spa, massage, sauna, steam room, wellness center)
  - parking        (parking lot, garage, car park, valet parking)
  - wifi           (wifi, internet, wireless, connectivity, network)
  - breakfast      (breakfast service, buffet, morning meal)
  - restaurant     (restaurant, dining room, food quality, menu)
  - bar            (bar, lounge, drinks, cocktails, happy hour)
  - room_service   (room service, in-room dining, delivery)
  - laundry        (laundry, washing machine, dry cleaning)
  - elevator       (elevator, lift, floor access, accessibility)
  - outdoor        (garden, terrace, patio, outdoor seating, BBQ, barbecue)
  - business       (business center, meeting room, conference facility)
  - kitchen        (kitchen, kitchenette, microwave, cooking, stove)
  - room_climate   (air conditioning, AC, heating, temperature control)
  - entertainment  (TV, television, channels, streaming, cable)
  - housekeeping   (housekeeping, daily cleaning, linen, towel change)
  - balcony        (balcony, private terrace, private outdoor space)"""


def extract_dim_names(dim_str: str) -> list:
    """Extract dimension names from formatted dimension string."""
    dims = []
    for line in dim_str.strip().split("\n"):
        line = line.strip()
        if line.startswith("-"):
            parts = line[1:].strip().split()
            if parts:
                dims.append(parts[0])
    return dims


ALL_DIMS = extract_dim_names(CORE_DIMENSIONS) + extract_dim_names(AVAILABLE_FACILITY_DIMS)


# ═══════════════════════════════════════════════════════════════
# PROMPTS
# ═══════════════════════════════════════════════════════════════

FACILITY_MAPPING_PROMPT = """You are a hotel facility analyzer for Expedia.

Given a hotel's facility list, map each facility to review dimensions
that travelers would realistically comment on.

## Hotel Facilities
{amenities}

## Standard Facility Dimensions
{available_dims}

## Rules
- Map each facility to the most appropriate standard dimension
- Only include dimensions travelers would actually write reviews about
- Multiple facilities can map to the same dimension
- Skip minor facilities unlikely to generate reviews
  (e.g., no_smoking, crib, extra_bed, toys, grocery, frontdesk_24_hour)

## Output (JSON only)
{{
  "facility_dimensions": [
    {{
      "amenity": "<original amenity tag>",
      "dimension": "<dimension name from standard list>",
      "description": "<2-5 keywords travelers use when reviewing this>"
    }}
  ],
  "unmapped_amenities": ["<amenity tags that don't fit any dimension>"]
}}"""


DIM_STALENESS_PROMPT = """You are a hotel experience analyst for Expedia.

For each dimension, determine if guest reviews become OUTDATED over time.

"time_sensitive" = quality/state can change significantly over months/years
  Examples: gym equipment degrades, breakfast quality changes, staff turns over

"stable" = information unlikely to change, absence of reviews ≠ stale
  Examples: physical location fixed, elevator presence fixed

## Dimensions to classify
{dimensions}

## Output (JSON only)
{{
  "classifications": [
    {{
      "dimension": "<name>",
      "is_time_sensitive": <true|false>,
      "reason": "<one sentence>"
    }}
  ]
}}"""


COMBINED_PROMPT = """You are a hotel review analyzer for Expedia.
Complete FIVE tasks for this review in ONE response.

## Review Text
{review_text}

## Review Date
{review_date}

## Hotel Info
Description: {hotel_description}
Policies: {hotel_policies}
Facilities this hotel has:
{facility_dimensions}

────────────────────────────────────────────

## Task 1: Quality Score
Score usefulness and specificity from 1-5:

1 - No useful content ("good", "ok", single word)
2 - Very vague, applies to any hotel ("great stay", "room was clean")
3 - Some useful info but generic ("comfortable bed", "good location")
4 - Specific and useful about this property
    ("king bed very firm", "breakfast open until 10am")
5 - Highly specific with actionable detail
    ("gym has 6 treadmills, crowded 7-9am")

## Task 2: Dimension Classification
Identify dimensions CLEARLY mentioned in the review.

Core dimensions (always apply):
{core_dimensions}

Facility dimensions (this hotel only):
{facility_dimensions}

Rules:
- Only classify dimensions listed above
- Only include dimensions CLEARLY mentioned — do not infer
- Return empty list if nothing specific is mentioned

## Task 3: Unlisted Facilities
Identify facilities the reviewer says the hotel HAS or PROVIDES
that are NOT in the facility dimensions list above.

Rules:
- Flag ONLY facilities the hotel HAS ("they had a rooftop bar")
- Do NOT flag absent/missing facilities ("no pool", "no breakfast")
- Normalize to closest name from standard list below:
{available_facility_dims}

Return empty list if none found.

## Task 4: Hotel Info Conflict (Staleness 4a — PERMANENT only)
Identify permanent factual conflicts: hotel info says something EXISTS
but reviewer says it is permanently gone/removed/discontinued.

Signal words for permanent: "permanently", "no longer", "has been removed",
"have stopped", "discontinued", "doesn't exist anymore"

Rules:
- PERMANENT changes only — temporary issues go to Task 5
- Objective facts only — subjective opinions do NOT qualify
- CRITICAL: Quality decline ≠ permanent conflict
  The facility must be GONE or REMOVED, not just worse quality
- FLAG:   "restaurant permanently closed" (hotel lists restaurant)
          "they no longer serve breakfast" (hotel says breakfast included)
- IGNORE: "pool closed for maintenance" → Task 5 (temporary)
          "gym too small" → subjective opinion
          "restaurant under new management, food worse" → quality decline, NOT 4a
          "breakfast quality has dropped" → quality decline, NOT 4a
          "staff was rude" → subjective, NOT 4a

Return empty list if no permanent conflicts.

## Task 5: Temporary Events (Staleness 4c)
Identify TEMPORARY unavailability that could recover.

Event types:
- closure:     "pool was closed", "restaurant not open"
- breakdown:   "gym equipment broken", "elevator not working", "wifi down"
- maintenance: "under renovation", "being repaired", "out of service"
- seasonal:    "only open in summer", "closed in winter"

Rules:
- Temporary only — permanent removals go to Task 4
- Objective states only — not subjective opinions
- Relevance based on review date vs today ({today_date}):
  review date = {review_date}
  < 3 months ago  → "high"
  3-12 months ago → "medium"
  > 12 months ago → "low"

Return empty list if no temporary events.

────────────────────────────────────────────

## Output (JSON only, no explanation)
{{
  "quality_score": <1-5>,
  "quality_reason": "<one sentence>",
  "dimensions": ["<dim1>", "<dim2>"],
  "dimension_reason": "<one sentence>",
  "unlisted_facilities": ["<normalized name or original>"],
  "info_conflicts": [
    {{
      "dimension": "<dim>",
      "hotel_info_says": "<what info claims>",
      "review_says": "<what reviewer experienced>",
      "conflict_summary": "<one sentence>"
    }}
  ],
  "temporary_events": [
    {{
      "dimension": "<dim>",
      "event_type": "<closure|breakdown|maintenance|seasonal>",
      "description": "<what reviewer described>",
      "relevance": "<high|medium|low>"
    }}
  ]
}}"""


# Fallback prompts (used when combined prompt JSON fails to parse)

QUALITY_FALLBACK_PROMPT = """You are a hotel review quality analyzer for Expedia.

## Review Text
{review_text}

Score from 1-5:
1 - No useful content
2 - Very vague, applies to any hotel
3 - Some useful info but generic
4 - Specific and useful about this property
5 - Highly specific with actionable detail

## Output (JSON only)
{{"score": <1-5>, "reason": "<one sentence>"}}"""


DIMENSION_FALLBACK_PROMPT = """You are a hotel review classifier for Expedia.

## Review Text
{review_text}

Core dimensions:
{core_dimensions}

Facility dimensions (this hotel only):
{facility_dimensions}

Also identify facilities the reviewer says the hotel HAS but are NOT listed above.
Normalize to the closest name from:
{available_facility_dims}
Do NOT flag absent facilities ("no pool", "no breakfast").

## Output (JSON only)
{{
  "dimensions": ["<dim1>", "<dim2>"],
  "reason": "<one sentence>",
  "unlisted_facilities": ["<normalized name or original>"]
}}"""


CONTRADICTION_PROMPT = """You are a hotel review analyst for Expedia.

Analyze these guest reviews for hotel dimension: {dimension}

Classify each review's direction:
- "positive": good, new, improving, well-functioning condition
- "negative": bad, old, broken, deteriorating, unavailable condition
- "neutral":  general mention, no clear direction
- "factual":  specific objective fact ("pool opens at 9am", "costs $15")

## Reviews (oldest to newest)
{review_summaries}

## Rules
- Focus ONLY on objective facts about {dimension}
- "I liked the gym" → neutral (preference, not fact)
- Classify based on DOMINANT direction if review mentions multiple things

## Output (JSON only)
{{
  "reviews": [
    {{
      "date": "<date>",
      "direction": "<positive|negative|neutral|factual>",
      "key_fact": "<specific claim in 10 words or less>"
    }}
  ]
}}"""


# ═══════════════════════════════════════════════════════════════
# API HELPER
# ═══════════════════════════════════════════════════════════════

def _extract_json(text: str) -> dict:
    """Robustly extract JSON from LLM response text."""
    # Strip markdown code fences
    text = re.sub(r"```(?:json)?\s*", "", text).strip()
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Find outermost { ... } or [ ... ]
    for open_ch, close_ch in [("{", "}"), ("[", "]")]:
        start = text.find(open_ch)
        end = text.rfind(close_ch)
        if start != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass
    raise json.JSONDecodeError("No valid JSON found", text, 0)


def call_api(prompt: str, retries: int = 3, max_tokens: int = 600) -> dict:
    """Call LLM API with retry logic. Returns parsed JSON dict or {}."""
    for attempt in range(retries):
        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=0,
                response_format={"type": "json_object"},
            )
            text = response.choices[0].message.content
            if not text:
                print(f"    Empty response (attempt {attempt+1}), finish_reason={response.choices[0].finish_reason}, retrying...")
                time.sleep(1)
                continue
            text = text.strip()
            return _extract_json(text)
        except json.JSONDecodeError:
            # Print first 200 chars of the response for debugging
            snippet = (text or "")[:200]
            print(f"    JSON parse error (attempt {attempt+1}): {repr(snippet)}")
            time.sleep(1)
        except Exception as e:
            print(f"    API error: {e}, retrying...")
            time.sleep(2 ** attempt)
    return {}


def safe_parse(val) -> list:
    """Safely parse a JSON string or return list as-is."""
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return []
    return []


# ═══════════════════════════════════════════════════════════════
# STEP 0: DATA LOADING & CLEANING
# ═══════════════════════════════════════════════════════════════

def load_data(reviews_path: str, desc_path: str) -> tuple:
    """Load reviews and hotel description CSVs."""
    print("Loading data...")
    reviews = pd.read_csv(reviews_path)
    desc    = pd.read_csv(desc_path)
    print(f"  Reviews: {len(reviews)} rows")
    print(f"  Hotels:  {len(desc)} rows")
    return reviews, desc


def is_english(text: str) -> bool:
    try:
        return detect(text) == "en"
    except LangDetectException:
        return True


def translate_to_english(text: str) -> str:
    try:
        return GoogleTranslator(source="auto", target="en").translate(text)
    except Exception:
        return text


def clean_data(reviews: pd.DataFrame) -> pd.DataFrame:
    """Drop empty reviews and translate non-English to English."""
    print("\nCleaning data...")

    before = len(reviews)
    reviews = reviews[
        reviews["review_text"].notna() &
        (reviews["review_text"].str.strip().str.len() > 0)
    ].copy()
    print(f"  Dropped {before - len(reviews)} empty rows → {len(reviews)} remaining")

    print("  Translating non-English reviews...")
    translated_count = 0

    def process_text(text):
        nonlocal translated_count
        text = str(text).strip()
        if not is_english(text):
            translated_count += 1
            return translate_to_english(text)
        return text

    reviews["review_text_clean"] = reviews["review_text"].apply(process_text)
    print(f"  Translated {translated_count} reviews")

    return reviews.reset_index(drop=True)


# ═══════════════════════════════════════════════════════════════
# STEP 1: CLASSIFY DIMENSIONS FOR 4d (once at startup)
# ═══════════════════════════════════════════════════════════════

def classify_dim_staleness(all_dims: list) -> dict:
    """
    Call AI once to classify which dimensions are time_sensitive.
    Used by 4d: only time_sensitive dims are checked for staleness.
    Returns: {dimension_name: True/False}
    """
    print("\n  Step 1: Classifying dimensions for 4d...")
    dims_str = "\n".join(f"  - {d}" for d in sorted(all_dims))

    result = call_api(
        DIM_STALENESS_PROMPT.format(dimensions=dims_str),
        max_tokens=1500
    )

    staleness_map = {}
    for item in result.get("classifications", []):
        dim = item.get("dimension", "")
        if dim:
            staleness_map[dim] = item.get("is_time_sensitive", True)

    # Default to True for any dimension not returned by AI
    for d in all_dims:
        staleness_map.setdefault(d, True)

    # If AI completely failed, log warning and use defaults
    if not staleness_map or len(staleness_map) < len(all_dims) // 2:
        print("    Warning: dim staleness classification incomplete, defaulting all to time_sensitive=True")
        staleness_map = {d: True for d in all_dims}

    n_sensitive = sum(1 for v in staleness_map.values() if v)
    print(f"    Time-sensitive: {n_sensitive}/{len(all_dims)} dimensions")
    return staleness_map


# ═══════════════════════════════════════════════════════════════
# STEP 2: AI FACILITY MAPPING (once per hotel)
# ═══════════════════════════════════════════════════════════════

def map_hotel_facilities(amenities: list) -> tuple:
    """
    Use AI to map hotel amenities → standard facility dimension names.
    Same standard names as used for unlisted facility normalization,
    so direct comparison is possible.

    Returns:
        facility_str  : formatted string injected into review prompt
        mapped_dims   : set of standard dim names this hotel has
        unmapped      : amenities AI could not map
    """
    if not amenities:
        return "  (none — this hotel has no special facilities)", set(), []

    result = call_api(
        FACILITY_MAPPING_PROMPT.format(
            amenities=json.dumps(amenities, indent=2),
            available_dims=AVAILABLE_FACILITY_DIMS
        ),
        max_tokens=1000
    )

    if not result or "facility_dimensions" not in result:
        return "  (could not map facilities)", set(), amenities

    seen, lines, mapped_dims = set(), [], set()
    for item in result.get("facility_dimensions", []):
        dim  = item.get("dimension", "")
        desc = item.get("description", "")
        if dim and dim not in seen:
            seen.add(dim)
            mapped_dims.add(dim)
            lines.append(f"  - {dim:<18} ({desc})")

    facility_str = "\n".join(lines) if lines else "  (none)"
    unmapped     = result.get("unmapped_amenities", [])
    return facility_str, mapped_dims, unmapped


def extract_hotel_info(hotel_row: pd.Series) -> tuple:
    """
    Extract hotel description and policies for 4a conflict detection.
    Returns: (description: str, policies: str)
    """
    description = str(hotel_row.get("property_description", "N/A"))[:200]

    policy_fields = [
        "check_in_instructions",
        "know_before_you_go",
    ]
    parts = []
    for field in policy_fields:
        val = hotel_row.get(field, "")
        if pd.notna(val) and str(val).strip():
            parts.append(str(val).strip()[:150])

    policies = " | ".join(parts) if parts else "N/A"
    return description, policies


# ═══════════════════════════════════════════════════════════════
# STEP 3: PER-REVIEW ANALYSIS (5 tasks in 1 call)
# ═══════════════════════════════════════════════════════════════

def analyze_review(
    review_text: str,
    review_date: str,
    facility_dims_str: str,
    hotel_mapped_dims: set,
    hotel_description: str,
    hotel_policies: str,
) -> dict:
    """
    Single API call combining 5 tasks:
      Task 1: Quality Score
      Task 2: Dimension Classification
      Task 3: Unlisted Facilities (positive mentions not in hotel info)
      Task 4: 4a — Permanent hotel info conflicts
      Task 5: 4c — Temporary events (breakdown/closure/seasonal)

    Unlisted facilities are normalized to same standard names as
    facility mapping → direct set comparison to detect truly unlisted vs
    wording mismatch.
    """
    today_date = date.today().strftime("%Y-%m-%d")

    result = call_api(
        COMBINED_PROMPT.format(
            review_text=review_text[:1000],
            review_date=review_date,
            today_date=today_date,
            hotel_description=hotel_description,
            hotel_policies=hotel_policies,
            core_dimensions=CORE_DIMENSIONS,
            facility_dimensions=facility_dims_str,
            available_facility_dims=AVAILABLE_FACILITY_DIMS,
        ),
        max_tokens=700
    )

    # Fallback: quality score
    if result.get("quality_score") is None:
        print("    Fallback: quality prompt...")
        q = call_api(QUALITY_FALLBACK_PROMPT.format(
            review_text=review_text[:1000]
        ))
        result["quality_score"]  = q.get("score")
        result["quality_reason"] = q.get("reason", "")

    # Fallback: dimensions + unlisted (stale fields default to empty)
    if "dimensions" not in result:
        print("    Fallback: dimension prompt...")
        d = call_api(DIMENSION_FALLBACK_PROMPT.format(
            review_text=review_text[:1000],
            core_dimensions=CORE_DIMENSIONS,
            facility_dimensions=facility_dims_str,
            available_facility_dims=AVAILABLE_FACILITY_DIMS,
        ))
        result["dimensions"]          = d.get("dimensions", [])
        result["dimension_reason"]    = d.get("reason", "")
        result["unlisted_facilities"] = d.get("unlisted_facilities", [])
        result["info_conflicts"]      = []
        result["temporary_events"]    = []

    dims        = safe_parse(result.get("dimensions", []))
    unlisted    = safe_parse(result.get("unlisted_facilities", []))
    conflicts   = safe_parse(result.get("info_conflicts", []))
    temp_events = safe_parse(result.get("temporary_events", []))

    # Split unlisted into truly unlisted vs wording mismatch
    # Both use same standard names → direct set comparison
    truly_unlisted = [f for f in unlisted if f not in hotel_mapped_dims]
    in_hotel_info  = [f for f in unlisted if f in hotel_mapped_dims]

    return {
        "quality_score":       result.get("quality_score"),
        "quality_reason":      result.get("quality_reason", ""),
        "dimensions":          json.dumps(dims),
        "dimension_reason":    result.get("dimension_reason", ""),
        "n_dimensions":        len(dims),
        "unlisted_facilities": json.dumps(truly_unlisted),   # NOT in hotel info
        "in_hotel_info":       json.dumps(in_hotel_info),    # wording mismatch
        "info_conflicts":      json.dumps(conflicts),         # 4a
        "has_conflict":        len(conflicts) > 0,
        "temporary_events":    json.dumps(temp_events),       # 4c
        "has_temp_event":      len(temp_events) > 0,
    }


# ═══════════════════════════════════════════════════════════════
# STEP 4: 4b CROSS-REVIEW CONTRADICTION DETECTION
# ═══════════════════════════════════════════════════════════════

def _classify_review_directions(dimension: str, reviews_data: list) -> list:
    """
    Call AI to classify each review's direction for a given dimension.
    Uses quality_reason + review_text snippet as summary for better accuracy.

    reviews_data: [{"date": str, "summary": str, "text_snippet": str}]
    Returns: [{"date": str, "direction": str, "key_fact": str}]
    """
    summaries_str = "\n".join([
        f"  [{r['date']}] {r['summary']} | {r['text_snippet']}"
        for r in reviews_data
    ])

    # Use higher max_tokens: ~80 tokens per review in output
    needed_tokens = max(800, len(reviews_data) * 80)
    result = call_api(
        CONTRADICTION_PROMPT.format(
            dimension=dimension,
            review_summaries=summaries_str
        ),
        max_tokens=min(needed_tokens, 4000)
    )
    return result.get("reviews", [])


def _detect_stale_potential(classified_reviews: list) -> list:
    """
    Pure logic — no LLM needed.

    For each review, check if LATER (different date) reviews contradict it:
      ≥2 later reviews with opposite direction → STALE
       1 later review  with opposite direction → POTENTIAL

    Same-date contradictions = different rooms/guests on same day
      → labeled INCONSISTENT_ROOMS (not a time-based staleness)

    Example:
      gym_new (2021) → gym_old (2023) → gym_old (2024)
      gym_new is STALE (2 later contradictions)
    """
    directional = [
        r for r in classified_reviews
        if r.get("direction") in ["positive", "negative"]
    ]

    if len(directional) < 2:
        return []

    directional = sorted(directional, key=lambda x: x.get("date", ""))

    records = []
    for i, rev in enumerate(directional):
        rev_date = rev.get("date", "")

        all_other  = directional[:i] + directional[i+1:]
        opposite   = [r for r in all_other if r.get("direction") != rev.get("direction")]

        # Split into same-day vs different-day contradictions
        same_day_opp  = [r for r in opposite if r.get("date", "") == rev_date]
        later_opp     = [r for r in opposite if r.get("date", "") > rev_date]

        # Same-day contradictions → INCONSISTENT_ROOMS (structural issue, not time-based)
        if same_day_opp and not later_opp:
            records.append({
                "stale_review_date":  rev_date,
                "stale_direction":    rev.get("direction", ""),
                "stale_key_fact":     rev.get("key_fact", ""),
                "stale_status":       "INCONSISTENT_ROOMS",
                "evidence_dates":     ", ".join(e.get("date", "") for e in same_day_opp[:2]),
                "evidence_facts":     " | ".join(e.get("key_fact", "") for e in same_day_opp[:2]),
                "evidence_direction": same_day_opp[0].get("direction", ""),
            })
            continue

        # Time-based contradictions → STALE or POTENTIAL
        if len(later_opp) >= 2:
            status = "STALE"
        elif len(later_opp) == 1:
            status = "POTENTIAL"
        else:
            continue

        records.append({
            "stale_review_date":  rev_date,
            "stale_direction":    rev.get("direction", ""),
            "stale_key_fact":     rev.get("key_fact", ""),
            "stale_status":       status,
            "evidence_dates":     ", ".join(e.get("date", "") for e in later_opp[:2]),
            "evidence_facts":     " | ".join(e.get("key_fact", "") for e in later_opp[:2]),
            "evidence_direction": later_opp[0].get("direction", ""),
        })

    return records


def run_4b_detection(df: pd.DataFrame) -> pd.DataFrame:
    """
    Run 4b contradiction detection across all hotel × dimension pairs.

    Uses quality_reason + review_text snippet as per-review summary,
    so AI has enough context to judge direction for a specific dimension.

    Returns DataFrame of STALE/POTENTIAL contradiction records.
    """
    print("\n  Step 4: 4b contradiction detection...")

    hq_df = df[df["quality_score"].notna() & (df["quality_score"] > 2)].copy()

    # Group by hotel × dimension → list of {date, summary, text_snippet}
    groups = {}
    for _, row in hq_df.iterrows():
        hotel_id     = row["eg_property_id"]
        review_date  = str(row.get("acquisition_date", "unknown"))
        summary      = str(row.get("quality_reason", ""))
        text_snippet = str(row.get("review_text_clean", ""))[:150]

        if not summary or summary == "nan":
            continue

        all_dims = set()
        try: all_dims.update(safe_parse(row["dimensions"]))
        except: pass
        try: all_dims.update(safe_parse(row["unlisted_facilities"]))
        except: pass

        for dim in all_dims:
            groups.setdefault((hotel_id, dim), []).append({
                "date":         review_date,
                "summary":      summary,
                "text_snippet": text_snippet,
            })

    # Only process pairs with ≥2 reviews
    groups = {k: v for k, v in groups.items() if len(v) >= 2}
    print(f"    Hotel-dimension pairs with ≥2 HQ reviews: {len(groups)}")

    all_records = []
    for idx, ((hotel_id, dimension), reviews_data) in enumerate(groups.items()):
        if idx % 10 == 0:
            print(f"    Processing {idx}/{len(groups)}...")

        reviews_data = sorted(reviews_data, key=lambda x: x["date"])

        n_rev = len(reviews_data)
        # Cap at 30 reviews per group — keep newest for staleness detection
        if n_rev > 30:
            reviews_data = reviews_data[-30:]

        if idx < 5 or n_rev > 30:
            print(f"      [{idx}] hotel={hotel_id} dim={dimension} reviews={n_rev}{'→30' if n_rev > 30 else ''}")

        classified = _classify_review_directions(dimension, reviews_data)
        if not classified:
            if idx < 5:
                print(f"      [{idx}] → empty result, skipping")
            time.sleep(SLEEP_BETWEEN)
            continue

        contradictions = _detect_stale_potential(classified)

        for c in contradictions:
            all_records.append({
                "hotel_id":           hotel_id,
                "dimension":          dimension,
                "stale_review_date":  c["stale_review_date"],
                "stale_direction":    c["stale_direction"],
                "stale_key_fact":     c["stale_key_fact"],
                "stale_status":       c["stale_status"],
                "evidence_dates":     c["evidence_dates"],
                "evidence_facts":     c["evidence_facts"],
                "evidence_direction": c["evidence_direction"],
                "staleness_type":     "4b_contradiction",
                "n_reviews_in_group": len(reviews_data),
            })

        time.sleep(SLEEP_BETWEEN)

    n = len(all_records)
    print(f"    4b: {n} contradiction records found")
    return pd.DataFrame(all_records) if all_records else pd.DataFrame()



# ═══════════════════════════════════════════════════════════════
# STEP 5b (pure computation): 4c EVENT TRACKING
# ═══════════════════════════════════════════════════════════════

# Resolution windows by event type
RESOLUTION_WINDOW = {
    "breakdown":   15,   # sudden — half a month
    "closure":     15,   # sudden — half a month
    "maintenance": 60,   # periodic — 2 months
    "seasonal":    60,   # periodic — 2 months
}


def run_4c_tracking(df: pd.DataFrame) -> pd.DataFrame:
    """
    Track resolution status of temporary events (4c).
    Pure computation — no LLM needed.

    For each 4c event detected in a review:
      1. Find the event date and dimension
      2. Look at later HQ reviews mentioning the same dimension
      3. Classify their direction (positive/negative) using quality_reason
      4. Determine resolution status:

         RESOLVED  — later HQ review(s) are positive about this dimension
         ONGOING   — later HQ review(s) are negative about this dimension
         TOO_EARLY — within resolution window, too soon to conclude
         UNKNOWN   — window has passed, no later reviews → needs followup

    Event windows:
      breakdown / closure   → 15 days  (sudden)
      maintenance / seasonal → 60 days  (periodic)
    """
    print("\n  Step 5b: 4c event tracking...")
    today = date.today()

    # Collect all 4c events from reviews
    events = []
    for _, row in df.iterrows():
        try:
            temp_events = safe_parse(row.get("temporary_events", "[]"))
        except Exception:
            continue

        for evt in temp_events:
            event_date_str = str(row.get("acquisition_date", ""))
            try:
                event_date = pd.to_datetime(event_date_str).date()
            except Exception:
                continue

            events.append({
                "hotel_id":          row["eg_property_id"],
                "dimension":         evt.get("dimension", ""),
                "event_type":        evt.get("event_type", ""),
                "event_description": evt.get("description", ""),
                "event_date":        event_date,
                "original_relevance":evt.get("relevance", ""),
                "review_text":       str(row.get("review_text_clean", ""))[:200],
            })

    if not events:
        print("    No 4c events found")
        return pd.DataFrame()

    # Build lookup: hotel × dimension → list of (date, quality_reason) for HQ reviews
    hq_dim_reviews = {}
    for _, row in df.iterrows():
        if not (pd.notna(row.get("quality_score")) and row.get("quality_score", 0) > 2):
            continue

        rev_date_str = str(row.get("acquisition_date", ""))
        try:
            rev_date = pd.to_datetime(rev_date_str).date()
        except Exception:
            continue

        reason = str(row.get("quality_reason", "")).lower()
        hotel_id = row["eg_property_id"]

        all_dims = set()
        try: all_dims.update(safe_parse(row["dimensions"]))
        except: pass
        try: all_dims.update(safe_parse(row["unlisted_facilities"]))
        except: pass

        for dim in all_dims:
            key = (hotel_id, dim)
            hq_dim_reviews.setdefault(key, []).append((rev_date, reason))

    # Negative signal words for quick direction classification
    NEGATIVE_WORDS = {
        "broken", "closed", "not working", "out of service", "unavailable",
        "poor", "bad", "terrible", "worst", "dirty", "old", "broken",
        "disappointing", "awful", "horrible", "not available", "still closed",
        "maintenance", "renovation", "under repair"
    }
    POSITIVE_WORDS = {
        "great", "excellent", "good", "amazing", "wonderful", "perfect",
        "clean", "new", "renovated", "open", "available", "working",
        "beautiful", "fantastic", "love", "loved", "best"
    }

    def classify_direction(reason: str) -> str:
        neg = sum(1 for w in NEGATIVE_WORDS if w in reason)
        pos = sum(1 for w in POSITIVE_WORDS if w in reason)
        if pos > neg:
            return "positive"
        elif neg > pos:
            return "negative"
        return "neutral"

    # Process each event
    rows = []
    for evt in events:
        hotel_id   = evt["hotel_id"]
        dimension  = evt["dimension"]
        event_date = evt["event_date"]
        event_type = evt["event_type"]
        window     = RESOLUTION_WINDOW.get(event_type, 60)

        days_since = (today - event_date).days

        # Find later HQ reviews mentioning the same dimension
        key = (hotel_id, dimension)
        later_reviews = [
            (d, r) for d, r in hq_dim_reviews.get(key, [])
            if d > event_date
        ]

        if later_reviews:
            # Classify direction of later reviews
            directions = [classify_direction(r) for _, r in later_reviews]
            n_pos = directions.count("positive")
            n_neg = directions.count("negative")

            if n_pos > n_neg:
                status = "RESOLVED"
            elif n_neg > 0:
                status = "ONGOING"
            else:
                status = "UNKNOWN"
        else:
            # No later reviews
            if days_since < window:
                status = "TOO_EARLY"
            else:
                status = "UNKNOWN"

        rows.append({
            "hotel_id":           hotel_id,
            "dimension":          dimension,
            "event_type":         event_type,
            "event_date":         str(event_date),
            "event_description":  evt["event_description"],
            "days_since_event":   days_since,
            "resolution_window":  window,
            "window_type":        "sudden (15d)" if window == 15 else "periodic (60d)",
            "status":             status,
            "needs_followup":     status in ("UNKNOWN", "ONGOING"),
            "n_later_reviews":    len(later_reviews),
            "original_relevance": evt["original_relevance"],
            "review_text":        evt["review_text"],
            "staleness_type":     "4c_event_tracking",
        })

    result_df = pd.DataFrame(rows) if rows else pd.DataFrame()
    if not result_df.empty:
        n_unknown  = (result_df["status"] == "UNKNOWN").sum()
        n_ongoing  = (result_df["status"] == "ONGOING").sum()
        n_resolved = (result_df["status"] == "RESOLVED").sum()
        n_early    = (result_df["status"] == "TOO_EARLY").sum()
        print(f"    4c events: {len(result_df)} total")
        print(f"      RESOLVED={n_resolved} ONGOING={n_ongoing} "
              f"UNKNOWN={n_unknown} TOO_EARLY={n_early}")

    return result_df


# ═══════════════════════════════════════════════════════════════
# STEP 5 (pure computation): 4d TIME STALE DETECTION
# ═══════════════════════════════════════════════════════════════

def run_4d_detection(df: pd.DataFrame, dim_staleness_map: dict) -> pd.DataFrame:
    """
    Detect time stale dimensions (4d) — pure computation, no LLM.

    For each hotel × dimension:
      - Find latest high-quality review (score > 2) date
      - If days since > STALE_THRESHOLD and dimension is time_sensitive → stale

    Dimensions classified as "stable" by AI (elevator, parking, etc.)
    are skipped — absence of reviews ≠ stale for stable dimensions.
    """
    today = date.today()
    rows  = []

    for hotel_id, group in df.groupby("eg_property_id"):
        hq_group = group[
            group["quality_score"].notna() &
            (group["quality_score"] > 2)
        ].copy()

        if len(hq_group) == 0:
            continue

        # Collect dim → [dates] from HQ reviews
        dim_dates = {}
        for _, rev in hq_group.iterrows():
            rev_date = rev.get("acquisition_date", None)
            if not rev_date or str(rev_date) == "nan":
                continue
            try:
                parsed_date = pd.to_datetime(rev_date).date()
            except Exception:
                continue

            all_dims = set()
            try: all_dims.update(safe_parse(rev["dimensions"]))
            except: pass
            try: all_dims.update(safe_parse(rev["unlisted_facilities"]))
            except: pass

            for dim in all_dims:
                dim_dates.setdefault(dim, []).append(parsed_date)

        for dim, dates in dim_dates.items():
            # Skip stable dimensions
            if not dim_staleness_map.get(dim, True):
                continue

            latest_date   = max(dates)
            days_since    = (today - latest_date).days
            is_time_stale = days_since > STALE_THRESHOLD

            rows.append({
                "hotel_id":          hotel_id,
                "dimension":         dim,
                "latest_hq_date":    str(latest_date),
                "days_since":        days_since,
                "threshold_days":    STALE_THRESHOLD,
                "is_time_stale":     is_time_stale,
                "staleness_type":    "4d_time_stale" if is_time_stale else "",
                "is_time_sensitive": True,
            })

    return pd.DataFrame(rows) if rows else pd.DataFrame()


# ═══════════════════════════════════════════════════════════════
# MAIN PIPELINE ORCHESTRATOR
# ═══════════════════════════════════════════════════════════════

def run_pipeline(reviews: pd.DataFrame, desc: pd.DataFrame) -> tuple:
    """
    Orchestrate the full analysis pipeline.

    Returns:
        results_df       : per-review analysis results
        unmapped_map     : hotel_id → unmapped amenities
        dim_staleness_map: dimension → is_time_sensitive
    """
    print(f"\nPipeline: {len(reviews)} reviews × {len(desc)} hotels")
    print(f"Model: {MODEL}")

    # Step 1: Classify dimensions for 4d (1 API call)
    dim_staleness_map = classify_dim_staleness(ALL_DIMS)
    time.sleep(SLEEP_BETWEEN)

    # Step 2: AI facility mapping per hotel (13 API calls)
    print("\n  Step 2: AI facility mapping per hotel...")
    hotel_facility_str  = {}   # hotel_id → facility string for prompt
    hotel_mapped_dims   = {}   # hotel_id → set of standard dim names
    hotel_unmapped      = {}   # hotel_id → unmapped amenities
    hotel_info          = {}   # hotel_id → (description, policies)

    for _, row in desc.iterrows():
        hid  = row["eg_property_id"]
        city = row.get("city", str(hid)[:8])

        try:
            amenities = json.loads(row["popular_amenities_list"])
        except Exception:
            amenities = []

        fac_str, mapped, unmapped = map_hotel_facilities(amenities)
        hotel_facility_str[hid] = fac_str
        hotel_mapped_dims[hid]  = mapped
        hotel_unmapped[hid]     = unmapped
        hotel_info[hid]         = extract_hotel_info(row)

        print(f"    {city}: {len(amenities)} amenities → {len(mapped)} dims")
        time.sleep(SLEEP_BETWEEN)

    # Step 3: Per-review analysis — parallel (MAX_WORKERS concurrent calls)
    # Supports checkpoint resume: saves progress every 200 reviews
    CHECKPOINT_PATH = os.path.join(_SCRIPT_DIR, "step3_checkpoint.json")
    CHECKPOINT_EVERY = 200

    print(f"\n  Step 3: Analyzing {len(reviews)} reviews (5 tasks each, {MAX_WORKERS} parallel)...")

    rows_list   = list(enumerate(reviews.itertuples(index=False)))
    all_results = [None] * len(rows_list)
    completed   = 0

    # ── Resume from checkpoint if available ──
    skip_set = set()
    if os.path.exists(CHECKPOINT_PATH):
        try:
            with open(CHECKPOINT_PATH, "r") as f:
                ckpt = json.load(f)
            n_reviews_ckpt = ckpt.get("n_reviews", 0)
            if n_reviews_ckpt == len(rows_list):
                saved = ckpt.get("results", {})
                for k, v in saved.items():
                    idx = int(k)
                    if v is not None:
                        all_results[idx] = v
                        skip_set.add(idx)
                        completed += 1
                print(f"    ✓ Resumed checkpoint: {len(skip_set)}/{len(rows_list)} already done")
            else:
                print(f"    ⚠ Checkpoint has {n_reviews_ckpt} reviews but current run has {len(rows_list)} — ignoring checkpoint")
        except Exception as e:
            print(f"    ⚠ Could not load checkpoint: {e}")

    # Filter out already-done rows
    remaining = [(pos, row) for pos, row in rows_list if pos not in skip_set]
    if not remaining:
        print(f"    All {len(rows_list)} reviews already in checkpoint — skipping Step 3 API calls")
    else:
        print(f"    {len(remaining)} reviews remaining...")

    def analyze_row_tuple(args):
        pos, row = args
        row_dict = row._asdict()
        return pos, analyze_review(
            review_text       = row_dict.get("review_text_clean", ""),
            review_date       = str(row_dict.get("acquisition_date", "unknown")),
            facility_dims_str = hotel_facility_str.get(row_dict.get("eg_property_id"), "  (none)"),
            hotel_mapped_dims = hotel_mapped_dims.get(row_dict.get("eg_property_id"), set()),
            hotel_description = hotel_info.get(row_dict.get("eg_property_id"), ("N/A","N/A"))[0],
            hotel_policies    = hotel_info.get(row_dict.get("eg_property_id"), ("N/A","N/A"))[1],
        )

    def save_checkpoint():
        """Save current progress to checkpoint file."""
        ckpt_data = {
            "n_reviews": len(rows_list),
            "completed": completed,
            "results": {str(i): all_results[i] for i in range(len(all_results)) if all_results[i] is not None},
        }
        with open(CHECKPOINT_PATH, "w") as f:
            json.dump(ckpt_data, f)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(analyze_row_tuple, args): args[0] for args in remaining}
        for future in as_completed(futures):
            pos = futures[future]
            try:
                result_pos, result = future.result()
                all_results[result_pos] = result
            except Exception as e:
                print(f"    Error on row {pos}: {e}")
                all_results[pos] = {}
            completed += 1
            if completed % 50 == 0:
                print(f"    Completed {completed}/{len(rows_list)}...")
            if completed % CHECKPOINT_EVERY == 0:
                save_checkpoint()

    # Final checkpoint save
    save_checkpoint()
    print(f"    ✓ Step 3 complete. Checkpoint saved.")

    results_df = pd.concat([
        reviews.reset_index(drop=True),
        pd.DataFrame(all_results),
    ], axis=1)

    return results_df, hotel_unmapped, dim_staleness_map



# ═══════════════════════════════════════════════════════════════
# QUESTION GENERATION INPUT TABLE
# ═══════════════════════════════════════════════════════════════

def build_question_input_table(
    results_df:       pd.DataFrame,
    gap_df:           pd.DataFrame,
    unlisted_df:      pd.DataFrame,
    conf_df:          pd.DataFrame,
    contra_df:        pd.DataFrame,
    tracking_4c_df:   pd.DataFrame,
    stale_4d_df:      pd.DataFrame,
) -> pd.DataFrame:
    """
    Build the pipeline output table that drives question generation.

    One row = one issue (gap or stale).
    All columns needed by the priority algorithm and question generator.

    question_level:
      "dimension" → gap / 4d (what dimension needs fresh info)
      "event"     → 4a / 4b / 4c (what specific event needs confirmation)

    Cross-dimension signals (modifier inputs for priority algorithm):
      dim_has_stale  → gap/4d row: same dim also has active stale issue
      dim_has_gap    → event row: same dim also has coverage gap
    """
    from datetime import date
    TODAY = date.today()

    # Pre-build cross-dim signal sets
    stale_keys = set()
    if conf_df is not None and not conf_df.empty:
        for _, r in conf_df.iterrows():
            stale_keys.add((r["hotel_id"], r["dimension"]))
    if contra_df is not None and not contra_df.empty:
        for _, r in contra_df[contra_df["stale_status"].isin(
                ["STALE","POTENTIAL","INCONSISTENT_ROOMS"])].iterrows():
            stale_keys.add((r["hotel_id"], r["dimension"]))
    if tracking_4c_df is not None and not tracking_4c_df.empty:
        for _, r in tracking_4c_df[tracking_4c_df["needs_followup"]==True].iterrows():
            stale_keys.add((r["hotel_id"], r["dimension"]))
    if stale_4d_df is not None and not stale_4d_df.empty:
        for _, r in stale_4d_df[stale_4d_df["is_time_stale"]==True].iterrows():
            stale_keys.add((r["hotel_id"], r["dimension"]))

    gap_keys = set()
    if gap_df is not None and not gap_df.empty:
        for _, r in gap_df[gap_df["is_gap"]==True].iterrows():
            gap_keys.add((r["hotel_id"], r["dimension"]))
    if unlisted_df is not None and not unlisted_df.empty:
        for _, r in unlisted_df.iterrows():
            gap_keys.add((r["hotel_id"], r["facility"]))

    rows = []

    # ── GAP: coverage_gap ─────────────────────────────────────────────────────
    if gap_df is not None and not gap_df.empty:
        for _, r in gap_df[gap_df["is_gap"]==True].iterrows():
            key = (r["hotel_id"], r["dimension"])
            rows.append({
                "property_id":       r["hotel_id"],
                "question_level":    "dimension",
                "issue_type":        "gap",
                "gap_type":          "coverage_gap",
                "stale_type":        "",
                "dimension":         r["dimension"],
                "mention_rate":      r["mention_rate"],
                "hq_mention_count":  r["hq_mention_count"],
                "hq_total_reviews":  r["hq_total_reviews"],
                "days_since_latest": "",
                "stale_status":      "",
                "event_type":        "",
                "event_date":        "",
                "days_since_event":  "",
                "resolution_window": "",
                "relevance":         "",
                "dim_has_stale":     key in stale_keys,
                "dim_has_gap":       "",
                "evidence_a":        f"Mention rate: {r['mention_rate']*100:.1f}% ({r['hq_mention_count']}/{r['hq_total_reviews']} HQ reviews)",
                "evidence_b":        "",
            })

    # ── GAP: unlisted_facility ────────────────────────────────────────────────
    if unlisted_df is not None and not unlisted_df.empty:
        for _, r in unlisted_df.iterrows():
            key = (r["hotel_id"], r["facility"])
            rows.append({
                "property_id":       r["hotel_id"],
                "question_level":    "dimension",
                "issue_type":        "gap",
                "gap_type":          "unlisted_facility",
                "stale_type":        "",
                "dimension":         r["facility"],
                "mention_rate":      "",
                "hq_mention_count":  r["mention_count"],
                "hq_total_reviews":  "",
                "days_since_latest": "",
                "stale_status":      "",
                "event_type":        "",
                "event_date":        "",
                "days_since_event":  "",
                "resolution_window": "",
                "relevance":         "",
                "dim_has_stale":     key in stale_keys,
                "dim_has_gap":       "",
                "evidence_a":        f"Positively mentioned {r['mention_count']}x but not in hotel info",
                "evidence_b":        "",
            })

    # ── STALE: 4d_time_stale ──────────────────────────────────────────────────
    if stale_4d_df is not None and not stale_4d_df.empty:
        for _, r in stale_4d_df[stale_4d_df["is_time_stale"]==True].iterrows():
            key = (r["hotel_id"], r["dimension"])
            rows.append({
                "property_id":       r["hotel_id"],
                "question_level":    "dimension",
                "issue_type":        "stale",
                "gap_type":          "",
                "stale_type":        "4d_time_stale",
                "dimension":         r["dimension"],
                "mention_rate":      "",
                "hq_mention_count":  "",
                "hq_total_reviews":  "",
                "days_since_latest": r["days_since"],
                "stale_status":      "STALE",
                "event_type":        "",
                "event_date":        str(r["latest_hq_date"]),
                "days_since_event":  "",
                "resolution_window": r["threshold_days"],
                "relevance":         "",
                "dim_has_stale":     "",
                "dim_has_gap":       key in gap_keys,
                "evidence_a":        f"Last HQ review: {r['latest_hq_date']} ({r['days_since']}d ago)",
                "evidence_b":        f"Threshold: {r['threshold_days']}d",
            })

    # ── STALE: 4a_conflict ────────────────────────────────────────────────────
    if conf_df is not None and not conf_df.empty:
        for _, r in conf_df.iterrows():
            key = (r["hotel_id"], r["dimension"])
            rows.append({
                "property_id":       r["hotel_id"],
                "question_level":    "event",
                "issue_type":        "stale",
                "gap_type":          "",
                "stale_type":        "4a_conflict",
                "dimension":         r["dimension"],
                "mention_rate":      "",
                "hq_mention_count":  "",
                "hq_total_reviews":  "",
                "days_since_latest": "",
                "stale_status":      "CONFLICT",
                "event_type":        "info_conflict",
                "event_date":        str(r.get("review_date", "")),
                "days_since_event":  "",
                "resolution_window": "",
                "relevance":         "",
                "dim_has_stale":     "",
                "dim_has_gap":       key in gap_keys,
                "evidence_a":        str(r.get("hotel_info_says", ""))[:150],
                "evidence_b":        str(r.get("review_says", ""))[:150],
            })

    # ── STALE: 4b_contradiction ───────────────────────────────────────────────
    if contra_df is not None and not contra_df.empty:
        for _, r in contra_df[contra_df["stale_status"].isin(
                ["STALE","POTENTIAL","INCONSISTENT_ROOMS"])].iterrows():
            key = (r["hotel_id"], r["dimension"])
            try:
                rev_date = pd.to_datetime(r["stale_review_date"]).date()
                days_ago = (TODAY - rev_date).days
            except Exception:
                days_ago = ""
            rows.append({
                "property_id":       r["hotel_id"],
                "question_level":    "event",
                "issue_type":        "stale",
                "gap_type":          "",
                "stale_type":        "4b_contradiction",
                "dimension":         r["dimension"],
                "mention_rate":      "",
                "hq_mention_count":  "",
                "hq_total_reviews":  r.get("n_reviews_in_group", ""),
                "days_since_latest": "",
                "stale_status":      r["stale_status"],
                "event_type":        "contradiction",
                "event_date":        str(r["stale_review_date"]),
                "days_since_event":  days_ago,
                "resolution_window": "",
                "relevance":         "",
                "dim_has_stale":     "",
                "dim_has_gap":       key in gap_keys,
                "evidence_a":        str(r.get("stale_key_fact", ""))[:150],
                "evidence_b":        str(r.get("evidence_facts", ""))[:150],
            })

    # ── STALE: 4c_temp_event ──────────────────────────────────────────────────
    if tracking_4c_df is not None and not tracking_4c_df.empty:
        for _, r in tracking_4c_df[tracking_4c_df["needs_followup"]==True].iterrows():
            key = (r["hotel_id"], r["dimension"])
            rows.append({
                "property_id":       r["hotel_id"],
                "question_level":    "event",
                "issue_type":        "stale",
                "gap_type":          "",
                "stale_type":        "4c_temp_event",
                "dimension":         r["dimension"],
                "mention_rate":      "",
                "hq_mention_count":  r.get("n_later_reviews", ""),
                "hq_total_reviews":  "",
                "days_since_latest": "",
                "stale_status":      r["status"],
                "event_type":        r["event_type"],
                "event_date":        str(r["event_date"]),
                "days_since_event":  r["days_since_event"],
                "resolution_window": r["resolution_window"],
                "relevance":         r.get("original_relevance", ""),
                "dim_has_stale":     "",
                "dim_has_gap":       key in gap_keys,
                "evidence_a":        str(r.get("event_description", ""))[:150],
                "evidence_b":        str(r.get("window_type", "")),
            })

    if not rows:
        return pd.DataFrame()

    out = pd.DataFrame(rows)
    out = out.sort_values(
        ["property_id", "question_level", "issue_type", "stale_type"]
    ).reset_index(drop=True)
    return out

# ═══════════════════════════════════════════════════════════════
# SHEET 12: REVIEW LABEL TABLE (frontend stale/fresh display)
# ═══════════════════════════════════════════════════════════════

def build_review_label_table(
    results_df:     pd.DataFrame,
    contra_df:      pd.DataFrame,
    tracking_4c_df: pd.DataFrame,
) -> pd.DataFrame:
    """
    Build review-level stale/fresh labels for frontend display.
    Only includes reviews where staleness is CONFIRMED — no user confirmation needed.

    Label types:
      STALE           → 4b STALE: confirmed outdated by ≥2 later contradicting reviews
                        → hide or deprioritize on frontend
      ONGOING_STALE   → 4c ONGOING: event confirmed still happening by later negative review
                        → show with warning tag
      RESOLVED_STALE  → 4c RESOLVED: original event review, now superseded
                        → show with "situation resolved" tag
      FRESH           → later review that confirmed the contradiction or resolution
                        → highlight / pin to top

    display_action:
      hide            → remove from main listing (4b STALE with high confidence)
      deprioritize    → show at bottom with stale tag
      warn            → show with warning banner
      highlight       → show near top with "fresh info" tag
    """
    rows = []

    # ── 4b STALE: old review confirmed outdated ───────────────────────────────
    if contra_df is not None and not contra_df.empty:
        stale_4b = contra_df[contra_df["stale_status"] == "STALE"].copy()

        for _, r in stale_4b.iterrows():
            # Stale review entry
            rows.append({
                "property_id":    r["hotel_id"],
                "dimension":      r["dimension"],
                "review_date":    r["stale_review_date"],
                "label":          "STALE",
                "label_source":   "4b_stale",
                "confidence":     "high",
                "display_action": "hide",
                "stale_key_fact": r.get("stale_key_fact", ""),
                "confirmed_by":   f"[{r.get('evidence_dates','')}]: {r.get('evidence_facts','')}",
                "note":           f"Confirmed stale by ≥2 later reviews contradicting: '{r.get('stale_key_fact','')}'"
            })

            # Fresh confirming reviews
            ev_dates = [d.strip() for d in str(r.get("evidence_dates","")).split(",") if d.strip()]
            ev_facts = [f.strip() for f in str(r.get("evidence_facts","")).split("|") if f.strip()]
            for i, ev_date in enumerate(ev_dates):
                rows.append({
                    "property_id":    r["hotel_id"],
                    "dimension":      r["dimension"],
                    "review_date":    ev_date,
                    "label":          "FRESH",
                    "label_source":   "4b_confirming",
                    "confidence":     "high",
                    "display_action": "highlight",
                    "stale_key_fact": "",
                    "confirmed_by":   ev_facts[i] if i < len(ev_facts) else "",
                    "note":           f"More recent review contradicts older info about {r['dimension']}"
                })

    # ── 4c RESOLVED: original event review now superseded ────────────────────
    if tracking_4c_df is not None and not tracking_4c_df.empty:
        resolved = tracking_4c_df[tracking_4c_df["status"] == "RESOLVED"].copy()

        for _, r in resolved.iterrows():
            # The original event review → resolved_stale
            rows.append({
                "property_id":    r["hotel_id"],
                "dimension":      r["dimension"],
                "review_date":    str(r["event_date"]),
                "label":          "RESOLVED_STALE",
                "label_source":   "4c_resolved",
                "confidence":     "high",
                "display_action": "deprioritize",
                "stale_key_fact": str(r.get("event_description", "")),
                "confirmed_by":   f"Later positive review confirmed recovery ({r.get('n_later_reviews',0)} reviews)",
                "note":           f"{r['event_type'].capitalize()} issue on {r['event_date']} — confirmed resolved by later reviews"
            })

        # ── 4c ONGOING: confirmed still happening ─────────────────────────────
        ongoing = tracking_4c_df[tracking_4c_df["status"] == "ONGOING"].copy()

        for _, r in ongoing.iterrows():
            rows.append({
                "property_id":    r["hotel_id"],
                "dimension":      r["dimension"],
                "review_date":    str(r["event_date"]),
                "label":          "ONGOING_STALE",
                "label_source":   "4c_ongoing",
                "confidence":     "high",
                "display_action": "warn",
                "stale_key_fact": str(r.get("event_description", "")),
                "confirmed_by":   f"Later negative review confirmed issue still exists ({r.get('n_later_reviews',0)} reviews)",
                "note":           f"{r['event_type'].capitalize()} issue on {r['event_date']} — confirmed STILL ONGOING by later reviews"
            })

    if not rows:
        return pd.DataFrame()

    out = pd.DataFrame(rows)
    out = out.sort_values(
        ["property_id", "dimension", "label", "review_date"]
    ).reset_index(drop=True)
    return out

# ═══════════════════════════════════════════════════════════════
# SAVE RESULTS TO EXCEL
# ═══════════════════════════════════════════════════════════════

def _sheet_gap_detection(df: pd.DataFrame) -> pd.DataFrame:
    """
    Sheet 3: Dimension Coverage + Gap Detection.

    Gap = mention_rate < 5% in high-quality reviews (score > 2).
    Dimensions counted = classified dims + unlisted facilities
    (unlisted count as coverage since they represent real guest experience).
    """
    rows = []
    for hotel_id, group in df.groupby("eg_property_id"):
        hq = group[group["quality_score"].notna() & (group["quality_score"] > 2)]
        n  = len(hq)
        if n == 0:
            continue

        dim_per_review = []
        for _, rev in hq.iterrows():
            dims = set()
            try: dims.update(safe_parse(rev["dimensions"]))
            except: pass
            try: dims.update(safe_parse(rev["unlisted_facilities"]))
            except: pass
            dim_per_review.append(dims)

        all_dims = [d for dims in dim_per_review for d in dims]
        for dim, count in Counter(all_dims).items():
            rate = count / n
            rows.append({
                "hotel_id":         hotel_id,
                "dimension":        dim,
                "hq_mention_count": count,
                "hq_total_reviews": n,
                "mention_rate":     round(rate, 3),
                "is_gap":           rate < 0.05,
            })
    return pd.DataFrame(rows)


def _sheet_unlisted(df: pd.DataFrame) -> pd.DataFrame:
    """Sheet 4: Unlisted Facilities (review says hotel HAS, but not in hotel info)."""
    rows = []
    for hotel_id, group in df.groupby("eg_property_id"):
        all_unlisted = []
        for u in group["unlisted_facilities"].dropna():
            try: all_unlisted.extend(safe_parse(u))
            except: pass
        for facility, count in Counter(all_unlisted).items():
            rows.append({
                "hotel_id":      hotel_id,
                "facility":      facility,
                "mention_count": count,
                "note":          "Positively mentioned in reviews but NOT in hotel info",
            })
    return pd.DataFrame(rows)


def _sheet_wording_mismatch(df: pd.DataFrame) -> pd.DataFrame:
    """Sheet 5: Wording Mismatch (same facility, different wording)."""
    rows = []
    for hotel_id, group in df.groupby("eg_property_id"):
        all_in = []
        for s in group["in_hotel_info"].dropna():
            try: all_in.extend(safe_parse(s))
            except: pass
        for facility, count in Counter(all_in).items():
            rows.append({
                "hotel_id":      hotel_id,
                "facility":      facility,
                "mention_count": count,
                "note":          "Hotel info has this — reviewer used different wording",
            })
    return pd.DataFrame(rows)


def _sheet_4a_conflicts(df: pd.DataFrame) -> pd.DataFrame:
    """Sheet 6: Info Conflicts (4a — permanent conflicts)."""
    rows = []
    for _, row in df.iterrows():
        for c in safe_parse(row.get("info_conflicts", "[]")):
            rows.append({
                "hotel_id":        row["eg_property_id"],
                "review_date":     row.get("acquisition_date", ""),
                "dimension":       c.get("dimension", ""),
                "hotel_info_says": c.get("hotel_info_says", ""),
                "review_says":     c.get("review_says", ""),
                "conflict_summary":c.get("conflict_summary", ""),
                "staleness_type":  "4a_permanent_conflict",
                "review_text":     str(row.get("review_text_clean", ""))[:200],
            })
    return pd.DataFrame(rows)


def _sheet_4c_temp_events(df: pd.DataFrame) -> pd.DataFrame:
    """Sheet 7: Temporary Events (4c — breakdown/closure/seasonal)."""
    rows = []
    for _, row in df.iterrows():
        for t in safe_parse(row.get("temporary_events", "[]")):
            rows.append({
                "hotel_id":       row["eg_property_id"],
                "review_date":    row.get("acquisition_date", ""),
                "dimension":      t.get("dimension", ""),
                "event_type":     t.get("event_type", ""),
                "description":    t.get("description", ""),
                "relevance":      t.get("relevance", ""),
                "staleness_type": "4c_temporary_event",
                "review_text":    str(row.get("review_text_clean", ""))[:200],
            })
    return pd.DataFrame(rows)


def save_results(
    df: pd.DataFrame,
    output_path: str,
    unmapped_map: dict,
    dim_staleness_map: dict,
    contradiction_df: pd.DataFrame,
    stale_4d_df: pd.DataFrame,
    tracking_4c_df: pd.DataFrame = None,
    question_input_df: pd.DataFrame = None,
    review_label_df: pd.DataFrame = None,
):
    """Save all analysis results to Excel (11 sheets + question input + review labels)."""
    print(f"\nSaving to {output_path}...")

    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:

        # Sheet 1: Full results
        df.to_excel(writer, sheet_name="Reviews Analyzed", index=False)

        # Sheet 2: Quality summary per hotel
        quality_summary = (
            df.groupby("eg_property_id")
            .agg(
                n_reviews      =("quality_score", "count"),
                avg_quality    =("quality_score", "mean"),
                pct_low_quality=("quality_score", lambda x: (x <= 2).mean()),
            )
            .round(3)
            .reset_index()
        )
        quality_summary.to_excel(writer, sheet_name="Quality Summary", index=False)

        # Sheet 3: Gap detection
        gap_df = _sheet_gap_detection(df)
        if not gap_df.empty:
            gap_df.to_excel(writer, sheet_name="Dimension Coverage", index=False)
            print(f"    Gap: {gap_df['is_gap'].sum()} gaps detected")

        # Sheet 4: Unlisted facilities
        unlisted_df = _sheet_unlisted(df)
        if not unlisted_df.empty:
            unlisted_df.to_excel(writer, sheet_name="Unlisted Facilities", index=False)

        # Sheet 5: Wording mismatch
        mismatch_df = _sheet_wording_mismatch(df)
        if not mismatch_df.empty:
            mismatch_df.to_excel(writer, sheet_name="Wording Mismatch", index=False)

        # Sheet 6: 4a permanent conflicts
        conflict_df = _sheet_4a_conflicts(df)
        if not conflict_df.empty:
            conflict_df.to_excel(writer, sheet_name="Info Conflicts (4a)", index=False)
            print(f"    4a: {len(conflict_df)} permanent conflict records")

        # Sheet 7: 4c temporary events (raw per-review detection)
        temp_df = _sheet_4c_temp_events(df)
        if not temp_df.empty:
            temp_df.to_excel(writer, sheet_name="Temp Events (4c)", index=False)
            print(f"    4c raw: {len(temp_df)} event records")

        # Sheet 7b: 4c event tracking (resolution status)
        if tracking_4c_df is not None and not tracking_4c_df.empty:
            tracking_4c_df.to_excel(
                writer, sheet_name="Event Tracking (4c)", index=False
            )
            n_followup = tracking_4c_df["needs_followup"].sum()
            print(f"    4c tracking: {n_followup} events need followup")

        # Sheet 8: 4d time stale
        if not stale_4d_df.empty:
            stale_4d_df.to_excel(writer, sheet_name="Time Stale (4d)", index=False)
            print(f"    4d: {stale_4d_df['is_time_stale'].sum()} stale hotel-dims")

        # Sheet 9: 4b contradictions
        if not contradiction_df.empty:
            contradiction_df.to_excel(writer, sheet_name="Contradictions (4b)", index=False)
            n_stale  = (contradiction_df["stale_status"] == "STALE").sum()
            n_pot    = (contradiction_df["stale_status"] == "POTENTIAL").sum()
            n_incons = (contradiction_df["stale_status"] == "INCONSISTENT_ROOMS").sum()
            print(f"    4b: {n_stale} STALE, {n_pot} POTENTIAL, {n_incons} INCONSISTENT_ROOMS")

        # Sheet 10: Unmapped amenities
        unmapped_rows = [
            {"hotel_id": hid, "amenity": a, "note": "AI could not map to any dimension"}
            for hid, amenities in unmapped_map.items()
            for a in amenities
        ]
        if unmapped_rows:
            pd.DataFrame(unmapped_rows).to_excel(
                writer, sheet_name="Unmapped Amenities", index=False
            )

        # Sheet 12: Question Input — priority-scored issues
        # → pipeline output contract for priority algorithm & question generator
        # NOTE: priority_score column added in main() before save_results() is called
        if question_input_df is not None and not question_input_df.empty:
            question_input_df.to_excel(
                writer, sheet_name="Question Input", index=False
            )
            print(f"    Question Input: {len(question_input_df)} issues "
                  f"({(question_input_df['question_level']=='dimension').sum()} dimension, "
                  f"{(question_input_df['question_level']=='event').sum()} event)")

        # Sheet 13: Review label table
        # → confirmed stale/fresh reviews for frontend display (no user confirmation needed)
        if review_label_df is not None and not review_label_df.empty:
            review_label_df.to_excel(
                writer, sheet_name="Review Labels", index=False
            )
            n_stale    = (review_label_df["label"].isin(["STALE","ONGOING_STALE","RESOLVED_STALE"])).sum()
            n_fresh    = (review_label_df["label"] == "FRESH").sum()
            print(f"    Review Labels: {n_stale} stale labels, {n_fresh} fresh labels")

    print(f"\n  Saved: {output_path}")
    print(f"  Sheets:")
    for i, name in enumerate([
        "Reviews Analyzed", "Quality Summary", "Dimension Coverage",
        "Unlisted Facilities", "Wording Mismatch", "Info Conflicts (4a)",
        "Temp Events (4c)", "Event Tracking (4c)", "Time Stale (4d)",
        "Contradictions (4b)", "Unmapped Amenities", "Question Input",
        "Review Labels"
    ], 1):
        print(f"    {i:2}. {name}")


# ═══════════════════════════════════════════════════════════════
# PRIORITY SCORING  (pure computation, 0 – 100)
# ═══════════════════════════════════════════════════════════════
#
# Grounded in Expedia kickoff transcript (George Haddad, VP Product AI):
#
#   "identifying missing or outdated property information"
#   "information becomes stale... if there was a renovation or something
#    new introduced, that immediately requires fresh data"
#   "capture useful information while MINIMIZING user effort"
#
# Liz (host) anti-pattern: "generate too many questions → hurt UX"
# → MAX_QUESTIONS_PER_HOTEL = 3  (enforced in export_json)
#
# Priority order  high → low:
#   1. 4a_conflict          hotel lists X but reviewer says permanently gone → misled travelers
#   2. 4c_temp_event ONGOING confirmed broken right now → current guests affected
#   3. 4b_contradiction STALE ≥2 reviews prove older info outdated
#   4. coverage_gap         traveler-relevant dim has < 5 % mentions → missing info
#   5. 4b POTENTIAL         1 contradicting review, unconfirmed
#   6. 4d_time_stale        no HQ review for 12+ months → renovation risk
#   7. unlisted_facility    guests mention facility not in listing
# ─────────────────────────────────────────────────────────────

MAX_QUESTIONS_PER_HOTEL = 3

_PRIORITY_BASE = {
    # Gap — info is missing → highest priority (most actionable for review collection)
    "coverage_gap":       90,   # dimensions rarely mentioned — need new reviews most
    "unlisted_facility":  82,   # guests mention amenities not in hotel listing
    # Stale — info is actively misleading
    "4a_conflict":        70,
    "4c_temp_event":      55,   # boosted further by ONGOING (+20) below
    "4b_contradiction":   50,   # adjusted by stale_status
    "4d_time_stale":      35,   # renovation risk if no recent reviews
}

_STALE_STATUS_MOD = {
    # 4c event resolution
    "ONGOING":             20,  # confirmed still happening → highest urgency
    "UNKNOWN":              8,  # window passed, unresolved
    "TOO_EARLY":            3,
    # 4b contradiction severity
    "STALE":               15,  # confirmed outdated by ≥2 later reviews
    "CONFLICT":            10,  # 4a direct hotel-info conflict
    "POTENTIAL":            5,  # only 1 contradicting review
    "INCONSISTENT_ROOMS":   2,
}

_RELEVANCE_MOD = {
    # Populated by pipeline for 4c based on review recency vs today
    "high":   15,   # review < 3 months ago
    "medium":  8,   # review 3–12 months ago
    "low":     0,
}


def _p_int(val, default=0) -> int:
    """Safe int cast for priority calc."""
    try:
        f = float(val)
        return default if math.isnan(f) else int(f)
    except (TypeError, ValueError):
        return default


def _p_str(val) -> str:
    v = str(val).strip()
    return "" if v in ("", "nan", "None") else v


def compute_priority(row) -> int:
    """
    Score one Question Input row 0–100.
    Called via: question_input_df.apply(compute_priority, axis=1)
    """
    score = 0

    issue_type   = _p_str(row.get("issue_type"))
    stale_type   = _p_str(row.get("stale_type"))
    gap_type     = _p_str(row.get("gap_type"))
    stale_status = _p_str(row.get("stale_status"))
    sub_type     = stale_type if issue_type == "stale" else gap_type

    # 1. Base score — class of problem
    score += _PRIORITY_BASE.get(sub_type, 10)

    # 2. Stale-status modifier (4a conflict / 4b contradiction / 4c event)
    score += _STALE_STATUS_MOD.get(stale_status, 0)

    # 3. 4c relevance (review recency vs today)
    score += _RELEVANCE_MOD.get(_p_str(row.get("relevance")), 0)

    # 4. Event recency bonus (4b / 4c): more recent = more urgent for travelers
    days_event = _p_int(row.get("days_since_event"), default=-1)
    if days_event >= 0:
        if days_event < 90:
            score += 10
        elif days_event < 180:
            score += 5
        elif days_event < 365:
            score += 2

    # 5. Staleness depth (4d): longer gap without reviews → more renovation risk
    days_stale = _p_int(row.get("days_since_latest"), default=-1)
    if days_stale > 0:
        if days_stale > 730:    # 2+ years
            score += 12
        elif days_stale > 365:  # 1–2 years
            score += 6

    # 6. Compound signal — same dimension has BOTH a gap AND a stale issue
    #    George: double blind spot, highest information value to close
    if str(row.get("dim_has_stale", "")).lower() == "true":
        score += 8
    if str(row.get("dim_has_gap", "")).lower() == "true":
        score += 5

    return min(score, 100)


# ═══════════════════════════════════════════════════════════════
# JSON EXPORT  (frontend static data, no server needed)
# ═══════════════════════════════════════════════════════════════

# Human-readable labels for dimension names shown to reviewer
_DIM_LABEL = {
    "bed_comfort": "bed and sleep quality", "room_noise": "noise levels",
    "room_size": "room size", "smell": "smell and freshness",
    "room_view": "view from the room", "room_cleanliness": "room cleanliness",
    "bathroom": "bathroom", "staff_attitude": "staff friendliness",
    "checkin_experience": "check-in and check-out",
    "decor_renovation": "room condition and decor",
    "lobby": "lobby and common areas", "value_for_money": "value for money",
    "location": "location", "pool": "pool", "kids_pool": "kids' pool",
    "hot_tub": "hot tub / jacuzzi", "gym_fitness": "gym and fitness center",
    "spa": "spa and wellness", "parking": "parking", "wifi": "Wi-Fi",
    "breakfast": "breakfast", "restaurant": "restaurant", "bar": "bar",
    "room_service": "room service", "laundry": "laundry",
    "elevator": "elevator", "outdoor": "outdoor spaces",
    "business": "business center", "kitchen": "kitchen / kitchenette",
    "room_climate": "air conditioning and heating",
    "entertainment": "TV and entertainment",
    "housekeeping": "housekeeping", "balcony": "balcony",
}


def export_json(
    question_input_df: pd.DataFrame,
    review_label_df:   pd.DataFrame,
    desc_df:           pd.DataFrame,
    output_dir:        str = "data",
):
    """
    Write three JSON files consumed directly by the frontend (GitHub Pages).

    data/issues.json         — top-3 priority issues per hotel, question_text placeholder
    data/hotels.json         — hotel summary cards
    data/review_labels.json  — STALE/FRESH labels per hotel
    """
    os.makedirs(output_dir, exist_ok=True)

    # ── issues.json ───────────────────────────────────────────────
    # Capped at MAX_QUESTIONS_PER_HOTEL per hotel (Liz anti-pattern: too many Qs = bad UX)
    if question_input_df is not None and not question_input_df.empty:
        top_issues = (
            question_input_df
            .sort_values(["property_id", "priority_score"], ascending=[True, False])
            .groupby("property_id", sort=False)
            .head(MAX_QUESTIONS_PER_HOTEL)
            .reset_index(drop=True)
        )

        def _row_to_issue(r):
            dim = r.get("dimension", "")
            return {
                "property_id":    str(r.get("property_id", "")),
                "dimension":      str(dim),
                "dimension_label": _DIM_LABEL.get(str(dim), str(dim)),
                "issue_type":     str(r.get("issue_type", "")),
                "stale_type":     str(r.get("stale_type", "")),
                "gap_type":       str(r.get("gap_type", "")),
                "stale_status":   str(r.get("stale_status", "")),
                "event_type":     str(r.get("event_type", "")),
                "event_date":     str(r.get("event_date", "")),
                "relevance":      str(r.get("relevance", "")),
                "priority_score": int(r.get("priority_score", 0)),
                "question_text":  "",   # placeholder — question_gen to be added
                "evidence_a":     str(r.get("evidence_a", "")),
                "evidence_b":     str(r.get("evidence_b", "")),
            }

        issues_by_hotel: dict = {}
        for _, r in top_issues.iterrows():
            pid = str(r.get("property_id", ""))
            issues_by_hotel.setdefault(pid, []).append(_row_to_issue(r))

        issues_path = os.path.join(output_dir, "issues.json")
        with open(issues_path, "w", encoding="utf-8") as f:
            json.dump(issues_by_hotel, f, ensure_ascii=False, indent=2)
        print(f"  issues.json       → {len(top_issues)} issues across {len(issues_by_hotel)} hotels  (cap={MAX_QUESTIONS_PER_HOTEL}/hotel)")

    # ── hotels.json ───────────────────────────────────────────────
    if desc_df is not None and not desc_df.empty:
        hotels = []
        for _, r in desc_df.iterrows():
            try:
                amenities = json.loads(str(r.get("popular_amenities_list", "[]")))
            except Exception:
                amenities = []
            hotels.append({
                "property_id":  str(r.get("eg_property_id", "")),
                "city":         str(r.get("city", "")),
                "province":     str(r.get("province", "")),
                "country":      str(r.get("country", "")),
                "star_rating":  r.get("star_rating", None),
                "avg_rating":   r.get("guestrating_avg_expedia", None),
                "description":  str(r.get("property_description", ""))[:300],
                "amenities":    amenities,
            })
        hotels_path = os.path.join(output_dir, "hotels.json")
        with open(hotels_path, "w", encoding="utf-8") as f:
            json.dump(hotels, f, ensure_ascii=False, indent=2)
        print(f"  hotels.json       → {len(hotels)} hotels")

    # ── review_labels.json ────────────────────────────────────────
    if review_label_df is not None and not review_label_df.empty:
        labels_by_hotel: dict = {}
        for _, r in review_label_df.iterrows():
            pid = str(r.get("property_id", ""))
            labels_by_hotel.setdefault(pid, []).append({
                "dimension":      str(r.get("dimension", "")),
                "review_date":    str(r.get("review_date", "")),
                "label":          str(r.get("label", "")),
                "display_action": str(r.get("display_action", "")),
                "confidence":     str(r.get("confidence", "")),
                "note":           str(r.get("note", "")),
            })
        labels_path = os.path.join(output_dir, "review_labels.json")
        with open(labels_path, "w", encoding="utf-8") as f:
            json.dump(labels_by_hotel, f, ensure_ascii=False, indent=2)
        counts = review_label_df["label"].value_counts().to_dict()
        print(f"  review_labels.json→ {counts}")

    print(f"  JSON export complete → ./{output_dir}/")


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def _run_single(desc, reviews_clean):
    """Run the full pipeline on a given set of reviews. Returns all result objects."""
    # Run main pipeline (Steps 1-3)
    results, unmapped_map, dim_staleness_map = run_pipeline(reviews_clean, desc)

    # Step 4: 4b contradiction detection
    contradiction_df = run_4b_detection(results)

    # Step 5a: 4c event tracking (pure computation)
    tracking_4c_df = run_4c_tracking(results)

    # Step 5b: 4d time stale (pure computation)
    stale_4d_df = run_4d_detection(results, dim_staleness_map)

    # Build question generation input table
    gap_sheet      = _sheet_gap_detection(results)
    unlisted_sheet = _sheet_unlisted(results)
    conf_sheet     = _sheet_4a_conflicts(results)

    question_input_df = build_question_input_table(
        results_df     = results,
        gap_df         = gap_sheet,
        unlisted_df    = unlisted_sheet,
        conf_df        = conf_sheet,
        contra_df      = contradiction_df,
        tracking_4c_df = tracking_4c_df,
        stale_4d_df    = stale_4d_df,
    )
    print(f"  Question input table: {len(question_input_df)} issues")

    # Priority scoring
    if not question_input_df.empty:
        question_input_df["priority_score"] = question_input_df.apply(
            compute_priority, axis=1
        )
    else:
        question_input_df["priority_score"] = []

    # Build review label table
    review_label_df = build_review_label_table(
        results_df     = results,
        contra_df      = contradiction_df,
        tracking_4c_df = tracking_4c_df,
    )
    print(f"  Review label table: {len(review_label_df)} labeled reviews")

    # Save all results
    save_results(
        results, OUTPUT_PATH,
        unmapped_map, dim_staleness_map,
        contradiction_df, stale_4d_df,
        tracking_4c_df,
        question_input_df,
        review_label_df,
    )

    # Export JSON
    print("\nExporting JSON for frontend...")
    export_json(question_input_df, review_label_df, desc, output_dir=os.path.join(_SCRIPT_DIR, "data"))

    # Clean up checkpoint on success
    _ckpt = os.path.join(_SCRIPT_DIR, "step3_checkpoint.json")
    if os.path.exists(_ckpt):
        os.remove(_ckpt)
        print("  Checkpoint cleaned up.")

    # Summary
    print("\n" + "=" * 50)
    print("DONE")
    print("=" * 50)
    print(f"  Reviews analyzed:       {len(results)}")
    print(f"  Avg quality score:      {results['quality_score'].mean():.2f}")
    print(f"  Low quality (<=2):      {(results['quality_score'] <= 2).mean():.1%}")
    print(f"  Reviews with 4a:        {results['has_conflict'].sum()}")
    print(f"  Reviews with 4c:        {results['has_temp_event'].sum()}")
    if not stale_4d_df.empty:
        print(f"  4d stale hotel-dims:    {stale_4d_df['is_time_stale'].sum()}")
    if not contradiction_df.empty:
        print(f"  4b STALE:               {(contradiction_df['stale_status']=='STALE').sum()}")
        print(f"  4b POTENTIAL:           {(contradiction_df['stale_status']=='POTENTIAL').sum()}")
    if tracking_4c_df is not None and not tracking_4c_df.empty:
        print(f"  4c needs followup:      {tracking_4c_df['needs_followup'].sum()}")

    return True


def main():
    import sys
    test_mode = "--test" in sys.argv

    # Load hotel descriptions
    _, desc = load_data(REVIEWS_PATH, DESC_PATH)

    # Load pre-cleaned reviews — generate from raw CSV if not cached
    if os.path.exists(CLEAN_CSV):
        print(f"\nLoading cached {CLEAN_CSV}...")
        reviews_clean = pd.read_csv(CLEAN_CSV)
        print(f"  Loaded: {len(reviews_clean)} rows")
    else:
        print(f"\n{CLEAN_CSV} not found — generating from raw reviews...")
        reviews_raw, _ = load_data(REVIEWS_PATH, DESC_PATH)
        reviews_clean = clean_data(reviews_raw)
        reviews_clean.to_csv(CLEAN_CSV, index=False)
        print(f"  Saved cleaned reviews to {CLEAN_CSV}")

    if test_mode:
        # ── Phase 1: test with 100 reviews ──
        print("\n" + "=" * 50)
        print("PHASE 1: TEST RUN (100 reviews)")
        print("=" * 50)
        _run_single(desc, reviews_clean.head(100))

        # ── Phase 2: auto-run full if test passed ──
        print("\n" + "=" * 50)
        print("PHASE 1 PASSED — starting FULL RUN (all reviews)")
        print("=" * 50)
        _run_single(desc, reviews_clean)
    else:
        _run_single(desc, reviews_clean)


if __name__ == "__main__":
    main()
