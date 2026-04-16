import { notFound } from "next/navigation";
import { getHotelById } from "@/lib/data-store";
import { ReviewsPageClient } from "@/components/reviews-page-client";

export default async function ReviewsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hotel = getHotelById(id);
  if (!hotel) notFound();
  return <ReviewsPageClient hotel={hotel} />;
}
