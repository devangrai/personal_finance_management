import { NextRequest, NextResponse } from "next/server";
import {
  applySuggestedTransactionRules,
  listSuggestedTransactionRules
} from "@/lib/transaction-rules";
import { getErrorMessage } from "@/lib/errors";

type ApplySuggestionsPayload = {
  suggestionIds?: string[];
};

export async function GET() {
  try {
    const suggestions = await listSuggestedTransactionRules();

    return NextResponse.json({
      suggestions
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(
          error,
          "Unable to load transaction rule suggestions."
        )
      },
      {
        status: 500
      }
    );
  }
}

export async function POST(request: NextRequest) {
  let payload: ApplySuggestionsPayload = {};

  try {
    payload = (await request.json()) as ApplySuggestionsPayload;
  } catch {
    payload = {};
  }

  try {
    const result = await applySuggestedTransactionRules({
      suggestionIds: payload.suggestionIds
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(
          error,
          "Unable to apply transaction rule suggestions."
        )
      },
      {
        status: 500
      }
    );
  }
}
