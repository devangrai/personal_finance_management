import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { getOrCreateUserProfile, updateUserProfile } from "@/lib/profile";

type UpdateProfilePayload = Partial<{
  birthYear: number | null;
  dependents: number | null;
  housingStatus: "rent_free" | "rent" | "mortgage" | "other";
  annualIncome: string | number | null;
  biweeklyNetPay: string | number | null;
  monthlyFixedExpense: string | number | null;
  emergencyFundTarget: string | number | null;
  targetRetirementSavingsRate: string | number | null;
  notes: string | null;
}>;

export async function GET() {
  try {
    const profile = await getOrCreateUserProfile();
    return NextResponse.json({ profile });
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to load the user profile.")
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  let payload: UpdateProfilePayload = {};

  try {
    payload = (await request.json()) as UpdateProfilePayload;
  } catch {
    payload = {};
  }

  try {
    const profile = await updateUserProfile(payload);
    return NextResponse.json({ profile });
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to update the user profile.")
      },
      { status: 500 }
    );
  }
}
