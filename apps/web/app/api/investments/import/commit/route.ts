import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { commitManualInvestmentImport } from "@/lib/manual-investments";

function readString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          error: "Attach a CSV file before importing it."
        },
        {
          status: 400
        }
      );
    }

    const result = await commitManualInvestmentImport({
      fileName: file.name,
      csvContent: await file.text(),
      importKind: readString(formData.get("importKind")) === "holdings" ? "holdings" : "transactions",
      accountName: readString(formData.get("accountName")),
      accountSubtype: readString(formData.get("accountSubtype")) || null,
      bucket: readString(formData.get("bucket")),
      isoCurrencyCode: readString(formData.get("isoCurrencyCode")) || null,
      asOfDate: readString(formData.get("asOfDate")) || null,
      source: readString(formData.get("source")) || null
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to import the manual investments CSV.")
      },
      {
        status: 500
      }
    );
  }
}
