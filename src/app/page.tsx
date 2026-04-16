"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Star, ChevronRight } from "lucide-react";
import { HotelRecord } from "@/types";
import { getHotelImage } from "@/lib/hotel-display";

/* Demo hotels — pick 3 with richest Pipeline data */
const DEMO_IDS = new Set([
  "db38b19b897dbece3e34919c662b3fd66d23b615395d11fb69264dd3a9b17723", // Broomfield
  "9a0043fd4258a1286db1e253ca591662b3aac849da12d0d4f67e08b8f59be65f", // Bochum
  "ff26cdda236b233f7c481f0e896814075ac6bed335e162e0ff01d5491343f838", // Frisco
]);

function ratingWord(r: number | null) {
  if (!r) return "Good";
  if (r >= 9) return "Wonderful";
  if (r >= 8) return "Very Good";
  return "Good";
}

export default function HomePage() {
  const router = useRouter();
  const [hotels, setHotels] = useState<HotelRecord[]>([]);

  useEffect(() => {
    fetch("/api/hotels")
      .then((r) => r.json())
      .then((j) => setHotels((j.hotels ?? []).filter((h: HotelRecord) => DEMO_IDS.has(h.id))));
  }, []);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="rounded-full bg-[#0a438b] px-5 py-2 text-lg font-bold text-white">expedia</div>
          <span className="text-sm font-medium text-slate-500">Adaptive Review Prompting System</span>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-[#0a438b] px-6 py-16 text-center text-white">
        <h1 className="text-4xl font-bold md:text-5xl">Smarter Hotel Reviews</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-blue-100">
          AI identifies what information is missing or outdated about a property,
          then asks guests the right follow-up questions to fill the gaps.
        </p>
      </section>

      {/* Hotel Cards */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <h2 className="text-2xl font-bold text-slate-900">Select a property</h2>
        <p className="mt-1 text-slate-500">Choose a hotel to explore its review analysis and write a review.</p>

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {hotels.map((hotel) => (
            <button
              key={hotel.id}
              type="button"
              onClick={() => router.push(`/hotels/${hotel.id}`)}
              className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:shadow-lg"
            >
              {/* Image */}
              <div className="relative h-48 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getHotelImage(hotel)}
                  alt={hotel.name}
                  className="h-full w-full object-cover transition group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                {hotel.starRating && (
                  <div className="absolute bottom-3 left-3 flex items-center gap-1">
                    {Array.from({ length: Math.round(hotel.starRating) }).map((_, i) => (
                      <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-5">
                <h3 className="text-lg font-bold text-slate-900">{hotel.name}</h3>
                <div className="mt-1 flex items-center gap-1 text-sm text-slate-500">
                  <MapPin className="h-3.5 w-3.5" />
                  {[hotel.city, hotel.country].filter(Boolean).join(", ")}
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <span className="rounded-md bg-emerald-700 px-2.5 py-1 text-sm font-bold text-white">
                    {(hotel.rating ?? 8).toFixed(1)}
                  </span>
                  <span className="text-sm text-slate-600">
                    {ratingWord(hotel.rating)} ({hotel.reviewCount} reviews)
                  </span>
                </div>

                <div className="mt-4 flex items-center gap-1 text-sm font-semibold text-[#0a438b] group-hover:underline">
                  View property & reviews <ChevronRight className="h-4 w-4" />
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
