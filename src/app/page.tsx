"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Star, ChevronRight, Search } from "lucide-react";
import { HotelRecord } from "@/types";
import { getHotelImage } from "@/lib/hotel-display";

function ratingWord(r: number | null) {
  if (!r) return "Good";
  if (r >= 9) return "Wonderful";
  if (r >= 8) return "Very Good";
  if (r >= 7) return "Good";
  if (r >= 6) return "Pleasant";
  return "Fair";
}

function ratingColor(r: number | null) {
  if (!r) return "bg-emerald-600";
  if (r >= 9) return "bg-emerald-700";
  if (r >= 8) return "bg-emerald-600";
  if (r >= 7) return "bg-yellow-600";
  return "bg-orange-500";
}

export default function HomePage() {
  const router = useRouter();
  const [hotels, setHotels] = useState<HotelRecord[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/hotels")
      .then((r) => r.json())
      .then((j) => setHotels(j.hotels ?? []));
  }, []);

  const filtered = hotels.filter((h) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      h.name.toLowerCase().includes(q) ||
      (h.city ?? "").toLowerCase().includes(q) ||
      (h.country ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <main className="min-h-screen bg-[#fafafa] text-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="rounded-full bg-[#0a438b] px-5 py-2 text-lg font-bold text-white">expedia</div>
          <span className="text-sm font-medium text-slate-500">Adaptive Review Prompting System</span>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-[#0a438b] px-6 py-14 text-center text-white">
        <h1 className="text-3xl font-bold md:text-4xl">Smarter Hotel Reviews</h1>
        <p className="mx-auto mt-3 max-w-2xl text-base text-blue-100">
          AI identifies what information is missing or outdated about a property,
          then asks guests the right follow-up questions to fill the gaps.
        </p>
      </section>

      {/* Search + Hotel Grid */}
      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">All Properties</h2>
            <p className="mt-1 text-sm text-slate-500">{hotels.length} hotels in dataset — select one to explore</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, city, or country..."
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((hotel) => (
            <button
              key={hotel.id}
              type="button"
              onClick={() => router.push(`/hotels/${hotel.id}`)}
              className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:shadow-lg hover:border-slate-300"
            >
              {/* Image */}
              <div className="relative h-44 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getHotelImage(hotel)}
                  alt={hotel.name}
                  className="h-full w-full object-cover transition group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                {hotel.starRating && (
                  <div className="absolute bottom-3 left-3 flex items-center gap-0.5">
                    {Array.from({ length: Math.round(hotel.starRating) }).map((_, i) => (
                      <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-4">
                <h3 className="text-base font-bold text-slate-900 leading-snug line-clamp-1">{hotel.name}</h3>
                <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                  <MapPin className="h-3 w-3" />
                  {[hotel.city, hotel.country].filter(Boolean).join(", ")}
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-md ${ratingColor(hotel.rating)} px-2 py-0.5 text-xs font-bold text-white`}>
                      {(hotel.rating ?? 8).toFixed(1)}
                    </span>
                    <span className="text-xs text-slate-600">
                      {ratingWord(hotel.rating)}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {hotel.reviewCount} reviews
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-[#0a438b] group-hover:underline">
                  View property <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </div>
            </button>
          ))}
        </div>

        {filtered.length === 0 && search.trim() && (
          <div className="text-center py-12 text-slate-400">
            No hotels match &quot;{search}&quot;
          </div>
        )}
      </section>
    </main>
  );
}
