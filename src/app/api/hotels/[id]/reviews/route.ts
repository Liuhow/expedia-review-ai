import { NextResponse } from "next/server";
import { addReviewForHotel, getHotelById, getReviewsForHotel, getReviewLabelsForHotel } from "@/lib/data-store";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hotel = getHotelById(id);
  if (!hotel) return NextResponse.json({ error: "Hotel not found." }, { status: 404 });
  return NextResponse.json({
    reviews: getReviewsForHotel(id),
    reviewLabels: getReviewLabelsForHotel(id),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hotel = getHotelById(id);
  if (!hotel) return NextResponse.json({ error: "Hotel not found." }, { status: 404 });

  const body = (await req.json()) as { title?: string; text?: string };
  if (!body.text?.trim()) {
    return NextResponse.json({ error: "Review text is required." }, { status: 400 });
  }

  const review = addReviewForHotel(id, { title: body.title, text: body.text });
  return NextResponse.json({ review }, { status: 201 });
}
