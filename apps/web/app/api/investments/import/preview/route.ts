import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { previewManualInvestmentImport } from "@/lib/manual-investments";

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
          error: "Attach a CSV file before previewing the import."
        },
        {
          status: 400
        }
      );
    }

    const preview = previewManualInvestmentImport({
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

    if (!preview.ok) {
      return NextResponse.json(
        {
          error: preview.error
        },
        {
          status: 400
        }
      );
    }

    return NextResponse.json(preview.summary);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to preview the manual investments import.")
      },
      {
        status: 500
      }
    );
  }
}
