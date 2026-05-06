import { NextResponse } from "next/server";
import { listCategories } from "@/lib/categories";

export async function GET() {
  try {
    const categories = await listCategories();

    return NextResponse.json({
      categories
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load categories.";

    return NextResponse.json(
      {
        error: message
      },
      {
        status: 500
      }
    );
  }
}
