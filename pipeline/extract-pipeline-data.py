"""
Extract ALL pipeline data from reviews_analyzed.xlsx + raw CSVs
into the JSON files consumed by the Next.js frontend (src/data/).

Produces 6 JSON files:
  1. hotels.json            — full HotelRecord[] from Description CSV
  2. reviews-by-hotel.json  — Record<hotelId, ReviewRecord[]> from Reviews CSV
  3. issues.json            — Record<hotelId, PipelineIssue[]> from Question Input sheet
  4. review-labels.json     — Record<hotelId, PipelineReviewLabel[]> from Review Labels sheet
  5. dimension-coverage.json— Record<hotelId, PipelineDimensionCoverage[]>
  6. time-stale.json        — Record<hotelId, PipelineTimeStale[]>

Usage:
  cd pipeline
  python extract-pipeline-data.py
  # or from project root:
  python pipeline/extract-pipeline-data.py
"""

import json
import math
import os
import pandas as pd

# ── Paths ────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR   = os.path.join(SCRIPT_DIR, "data")
OUT_DIR    = os.path.join(SCRIPT_DIR, "..", "src", "data")

EXCEL_PATH    = os.path.join(SCRIPT_DIR, "reviews_analyzed.xlsx")
DESC_CSV      = os.path.join(DATA_DIR, "Description_PROC.csv")
REVIEWS_CSV   = os.path.join(DATA_DIR, "Reviews_PROC.csv")

os.makedirs(OUT_DIR, exist_ok=True)


def nan_safe(val):
    """Convert NaN/None to sensible defaults for JSON."""
    if val is None:
        return None
    if isinstance(val, float) and math.isnan(val):
        return None
    return val


def safe_str(val, default=""):
    if pd.isna(val):
        return default
    return str(val).strip()


def parse_json_list(val):
    """Parse a JSON list from a CSV cell, return [] on failure."""
    if pd.isna(val):
        return []
    try:
        result = json.loads(str(val))
        return result if isinstance(result, list) else []
    except Exception:
        return []


def parse_pipe_list(val):
    """Parse pipe-separated or semicolon-separated string into list."""
    if pd.isna(val) or not str(val).strip():
        return []
    text = str(val).strip()
    # Try common separators
    for sep in ["|", ";", "\n"]:
        if sep in text:
            return [s.strip() for s in text.split(sep) if s.strip()]
    return [text] if text else []


# ═══════════════════════════════════════════════════════════════
# 1. hotels.json  — full HotelRecord from Description CSV
# ═══════════════════════════════════════════════════════════════

def extract_hotels():
    print("Extracting hotels.json...")
    desc = pd.read_csv(DESC_CSV)
    reviews_df = pd.read_csv(REVIEWS_CSV)

    # Count reviews per hotel
    review_counts = reviews_df.groupby("eg_property_id").size().to_dict()

    hotels = []
    for _, row in desc.iterrows():
        hid = str(row["eg_property_id"])

        # Parse amenities
        popular = parse_json_list(row.get("popular_amenities_list"))

        # Build amenity categories
        amenity_categories = {
            "accessibility":     parse_pipe_list(row.get("property_amenity_accessibility")),
            "activitiesNearby":  parse_pipe_list(row.get("property_amenity_activities_nearby")),
            "businessServices":  parse_pipe_list(row.get("property_amenity_business_services")),
            "conveniences":      parse_pipe_list(row.get("property_amenity_conveniences")),
            "familyFriendly":    parse_pipe_list(row.get("property_amenity_family_friendly")),
            "foodAndDrink":      parse_pipe_list(row.get("property_amenity_food_and_drink")),
            "guestServices":     parse_pipe_list(row.get("property_amenity_guest_services")),
            "internet":          parse_pipe_list(row.get("property_amenity_internet")),
            "langsSpoken":       parse_pipe_list(row.get("property_amenity_langs_spoken")),
            "more":              parse_pipe_list(row.get("property_amenity_more")),
            "outdoor":           parse_pipe_list(row.get("property_amenity_outdoor")),
            "parking":           parse_pipe_list(row.get("property_amenity_parking")),
            "spa":               parse_pipe_list(row.get("property_amenity_spa")),
            "thingsToDo":        parse_pipe_list(row.get("property_amenity_things_to_do")),
        }

        # Check-in / Check-out
        check_in = {
            "startTime": safe_str(row.get("check_in_start_time")) or None,
            "endTime":   safe_str(row.get("check_in_end_time")) or None,
            "instructions": parse_pipe_list(row.get("check_in_instructions")),
        }
        check_out = {
            "time":   safe_str(row.get("check_out_time")) or None,
            "policy": parse_pipe_list(row.get("check_out_policy")),
        }

        # Policies
        policies = {
            "pet":                parse_pipe_list(row.get("pet_policy")),
            "childrenAndExtraBed": parse_pipe_list(row.get("children_and_extra_bed_policy")),
            "knowBeforeYouGo":    parse_pipe_list(row.get("know_before_you_go")),
        }

        # Build a name from city if no explicit name column
        city = safe_str(row.get("city")) or None
        country = safe_str(row.get("country")) or None
        name_parts = [p for p in [city, country] if p]
        name = " ".join(name_parts) + " Stay" if name_parts else f"Hotel {hid[:8]}"

        hotels.append({
            "id":               hid,
            "name":             name,
            "city":             city,
            "province":         safe_str(row.get("province")) or None,
            "country":          country,
            "rating":           nan_safe(row.get("guestrating_avg_expedia")),
            "starRating":       nan_safe(row.get("star_rating")),
            "description":      safe_str(row.get("property_description")),
            "areaDescription":  safe_str(row.get("area_description")),
            "amenities":        popular,
            "reviewCount":      review_counts.get(hid, 0),
            "popularAmenities": popular,
            "amenityCategories": amenity_categories,
            "checkIn":          check_in,
            "checkOut":         check_out,
            "policies":         policies,
        })

    out_path = os.path.join(OUT_DIR, "hotels.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(hotels, f, ensure_ascii=True, indent=2)
    print(f"  → {len(hotels)} hotels written to {out_path}")
    return hotels


# ═══════════════════════════════════════════════════════════════
# 2. reviews-by-hotel.json — ReviewRecord[] per hotel
# ═══════════════════════════════════════════════════════════════

def extract_reviews():
    print("Extracting reviews-by-hotel.json...")
    reviews_df = pd.read_csv(REVIEWS_CSV)

    # Try to load pipeline quality_score + dimensions from Excel
    pipeline_meta = {}  # key: (hotel_id, date, text_prefix) → {quality_score, dimensions}
    if os.path.exists(EXCEL_PATH):
        try:
            analyzed = pd.read_excel(EXCEL_PATH, sheet_name="Reviews Analyzed")
            for _, arow in analyzed.iterrows():
                hid = str(arow["eg_property_id"])
                date_str = safe_str(arow.get("acquisition_date"))
                text_prefix = safe_str(arow.get("review_text"))[:60]
                key = (hid, date_str, text_prefix)

                qs = arow.get("quality_score")
                dims_raw = arow.get("dimensions")
                dims = []
                if pd.notna(dims_raw):
                    try:
                        dims = json.loads(str(dims_raw))
                        if not isinstance(dims, list):
                            dims = []
                    except Exception:
                        dims = []

                pipeline_meta[key] = {
                    "qualityScore": int(qs) if pd.notna(qs) else None,
                    "dimensions":   dims,
                }
            print(f"  Loaded pipeline metadata for {len(pipeline_meta)} reviews")
        except Exception as e:
            print(f"  ⚠ Could not load pipeline metadata: {e}")

    result = {}

    for _, row in reviews_df.iterrows():
        hid = str(row["eg_property_id"])
        text = safe_str(row.get("review_text"))
        if not text:
            continue

        # Build rating JSON from the rating column
        rating_raw = "{}"
        raw_rating = row.get("rating")
        if pd.notna(raw_rating):
            try:
                parsed = json.loads(str(raw_rating))
                rating_raw = json.dumps(parsed)
            except Exception:
                try:
                    rating_raw = json.dumps({"overall": float(raw_rating)})
                except Exception:
                    pass

        # Look up pipeline metadata
        date_str = safe_str(row.get("acquisition_date"))
        text_prefix = text[:60]
        meta = pipeline_meta.get((hid, date_str, text_prefix), {})

        review = {
            "date":         date_str,
            "title":        safe_str(row.get("review_title")) or None,
            "text":         text,
            "ratingRaw":    rating_raw,
            "qualityScore": meta.get("qualityScore"),
            "dimensions":   meta.get("dimensions", []),
        }
        result.setdefault(hid, []).append(review)

    out_path = os.path.join(OUT_DIR, "reviews-by-hotel.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=True, indent=2)
    total_reviews = sum(len(v) for v in result.values())
    print(f"  → {total_reviews} reviews across {len(result)} hotels written to {out_path}")


# ═══════════════════════════════════════════════════════════════
# 3. issues.json — from Question Input sheet
# ═══════════════════════════════════════════════════════════════

def extract_issues():
    print("Extracting issues.json...")
    try:
        df = pd.read_excel(EXCEL_PATH, sheet_name="Question Input")
    except Exception as e:
        print(f"  ⚠ Question Input sheet not found: {e}")
        # Fall back to pipeline-generated issues.json
        pipeline_issues = os.path.join(DATA_DIR, "issues.json")
        if os.path.exists(pipeline_issues):
            import shutil
            out_path = os.path.join(OUT_DIR, "issues.json")
            shutil.copy2(pipeline_issues, out_path)
            print(f"  → Copied from pipeline data: {pipeline_issues}")
        return

    # Human-readable labels
    DIM_LABEL = {
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

    # Take top issues per hotel: up to 3 per stale_type/gap_type, max 15 total
    if "priority_score" in df.columns:
        df = df.sort_values(["property_id", "priority_score"], ascending=[True, False])
        # Top 3 per hotel × issue category to ensure diversity
        type_col = df["stale_type"].fillna(df["gap_type"]).fillna("other")
        df["_cat"] = type_col
        df = (
            df.groupby(["property_id", "_cat"], sort=False)
            .head(3)
            .groupby("property_id", sort=False)
            .head(15)
            .reset_index(drop=True)
        )
        df = df.drop(columns=["_cat"])

    result = {}
    for _, row in df.iterrows():
        hid = safe_str(row.get("property_id"))
        dim = safe_str(row.get("dimension"))
        entry = {
            "property_id":    hid,
            "dimension":      dim,
            "dimension_label": DIM_LABEL.get(dim, dim),
            "issue_type":     safe_str(row.get("issue_type")),
            "stale_type":     safe_str(row.get("stale_type")),
            "gap_type":       safe_str(row.get("gap_type")),
            "stale_status":   safe_str(row.get("stale_status")),
            "event_type":     safe_str(row.get("event_type")),
            "event_date":     safe_str(row.get("event_date")),
            "relevance":      safe_str(row.get("relevance")),
            "priority_score": int(row.get("priority_score", 0)) if pd.notna(row.get("priority_score")) else 0,
            "question_text":  "",
            "evidence_a":     safe_str(row.get("evidence_a")),
            "evidence_b":     safe_str(row.get("evidence_b")),
        }
        result.setdefault(hid, []).append(entry)

    out_path = os.path.join(OUT_DIR, "issues.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=True, indent=2)
    total = sum(len(v) for v in result.values())
    print(f"  → {total} issues across {len(result)} hotels written to {out_path}")


# ═══════════════════════════════════════════════════════════════
# 4. review-labels.json — from Review Labels sheet
# ═══════════════════════════════════════════════════════════════

def extract_review_labels():
    print("Extracting review-labels.json...")
    try:
        df = pd.read_excel(EXCEL_PATH, sheet_name="Review Labels")
    except Exception as e:
        print(f"  ⚠ Review Labels sheet not found: {e}")
        pipeline_labels = os.path.join(DATA_DIR, "review_labels.json")
        if os.path.exists(pipeline_labels):
            import shutil
            out_path = os.path.join(OUT_DIR, "review-labels.json")
            shutil.copy2(pipeline_labels, out_path)
            print(f"  → Copied from pipeline data: {pipeline_labels}")
        return

    result = {}
    for _, row in df.iterrows():
        hid = safe_str(row.get("property_id"))
        entry = {
            "dimension":      safe_str(row.get("dimension")),
            "review_date":    safe_str(row.get("review_date")),
            "label":          safe_str(row.get("label")),
            "display_action": safe_str(row.get("display_action")),
            "confidence":     safe_str(row.get("confidence")),
            "note":           safe_str(row.get("note")),
        }
        result.setdefault(hid, []).append(entry)

    out_path = os.path.join(OUT_DIR, "review-labels.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=True, indent=2)
    total = sum(len(v) for v in result.values())
    print(f"  → {total} labels across {len(result)} hotels written to {out_path}")


# ═══════════════════════════════════════════════════════════════
# 5. dimension-coverage.json — from Dimension Coverage sheet
# ═══════════════════════════════════════════════════════════════

def extract_dimension_coverage():
    print("Extracting dimension-coverage.json...")
    try:
        df = pd.read_excel(EXCEL_PATH, sheet_name="Dimension Coverage")
    except Exception as e:
        print(f"  ⚠ Dimension Coverage sheet not found: {e}")
        return

    result = {}
    for _, row in df.iterrows():
        hid = str(row["hotel_id"])
        entry = {
            "hotel_id":         hid,
            "dimension":        str(row["dimension"]),
            "hq_mention_count": int(row["hq_mention_count"]),
            "hq_total_reviews": int(row["hq_total_reviews"]),
            "mention_rate":     round(float(row["mention_rate"]), 4),
            "is_gap":           bool(row["is_gap"]),
        }
        result.setdefault(hid, []).append(entry)

    out_path = os.path.join(OUT_DIR, "dimension-coverage.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"  → {len(result)} hotels written to {out_path}")


# ═══════════════════════════════════════════════════════════════
# 6. time-stale.json — from Time Stale (4d) sheet
# ═══════════════════════════════════════════════════════════════

def extract_time_stale():
    print("Extracting time-stale.json...")
    try:
        df = pd.read_excel(EXCEL_PATH, sheet_name="Time Stale (4d)")
    except Exception as e:
        print(f"  ⚠ Time Stale sheet not found: {e}")
        return

    result = {}
    for _, row in df.iterrows():
        hid = str(row["hotel_id"])
        entry = {
            "hotel_id":         hid,
            "dimension":        str(row["dimension"]),
            "latest_hq_date":   str(row["latest_hq_date"]) if pd.notna(row["latest_hq_date"]) else None,
            "days_since":       int(row["days_since"]) if pd.notna(row["days_since"]) else None,
            "is_time_stale":    bool(row["is_time_stale"]),
            "is_time_sensitive": bool(row["is_time_sensitive"]),
        }
        result.setdefault(hid, []).append(entry)

    out_path = os.path.join(OUT_DIR, "time-stale.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"  → {len(result)} hotels written to {out_path}")


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print(f"Pipeline Excel: {EXCEL_PATH}")
    print(f"Output dir:     {OUT_DIR}")
    print()

    # These two come from raw CSVs (always available)
    extract_hotels()
    extract_reviews()

    # These four come from the pipeline Excel (need pipeline to have run)
    if os.path.exists(EXCEL_PATH):
        extract_issues()
        extract_review_labels()
        extract_dimension_coverage()
        extract_time_stale()
    else:
        print(f"\n⚠ Excel not found at {EXCEL_PATH}")
        print("  Run pipeline.py first, then re-run this script.")
        print("  Hotels and reviews have been extracted from CSVs.")

    print("\nDone! Frontend data is in src/data/")
