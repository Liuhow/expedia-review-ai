import { notFound } from "next/navigation";
import { HotelDetailClient } from "@/components/hotel-detail-client";
import { getHotelById } from "@/lib/data-store";

export default async function HotelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hotel = getHotelById(id);

  if (!hotel) {
    notFound();
  }

  return <HotelDetailClient hotel={hotel} />;
}