import { notFound } from "next/navigation";
import { getHotelById } from "@/lib/data-store";
import { WriteReviewPageClient } from "@/components/write-review-page-client";

export default async function WriteReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hotel = getHotelById(id);
  if (!hotel) notFound();
  return <WriteReviewPageClient hotel={hotel} />;
}
