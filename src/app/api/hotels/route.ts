import { NextResponse } from "next/server";
import { listHotels } from "@/lib/data-store";

export async function GET() {
  return NextResponse.json({ hotels: listHotels() });
}
