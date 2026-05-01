import { createHash } from "node:crypto";
import { ManualInvestmentBucket, prisma } from "@portfolio/db";
import { getOrCreateDefaultUser } from "./user";

export type ManualInvestmentImportKind = "transactions" | "holdings";

type ParsedCsvRow = {
  lineNumber: number;
  values: string[];
};

type ParsedCsvTable = {
  headers: string[];
  normalizedHeaders: string[];
  rows: ParsedCsvRow[];
};

type ImportMetadata = {
  source: string;
  accountName: string;
  accountSubtype: string | null;
  bucket: keyof typeof ManualInvestmentBucket;
  isoCurrencyCode: string;
};

type PreviewTransactionRow = {
  date: string;
  name: string;
  type: string;
  subtype: string | null;
  symbol: string | null;
  amount: string;
  quantity: string | null;
  price: string | null;
  fees: string | null;
};

type PreviewHoldingRow = {
  asOf: string;
  securityName: string;
  symbol: string | null;
  quantity: string | null;
  institutionPrice: string | null;
  institutionValue: string;
  costBasis: string | null;
};

type ParsedTransactionRow = {
  rowFingerprint: string;
  date: Date;
  name: string;
  type: string;
  subtype: string | null;
  symbol: string | null;
  securityId: string | null;
  amount: string;
  quantity: string | null;
  price: string | null;
  fees: string | null;
  isoCurrencyCode: string;
  rawRow: Record<string, string>;
};

type ParsedHoldingRow = {
  rowFingerprint: string;
  asOf: Date;
  securityName: string;
  symbol: string | null;
  securityId: string | null;
  quantity: string | null;
  institutionPrice: string | null;
  institutionValue: string;
  costBasis: string | null;
  isoCurrencyCode: string;
  rawRow: Record<string, string>;
};

type PreviewSuccess =
  | {
      ok: true;
      kind: "transactions";
      summary: {
        fileName: string;
        importKind: "transactions";
        accountName: string;
        accountSubtype: string | null;
        bucket: keyof typeof ManualInvestmentBucket;
        isoCurrencyCode: string;
        rowCount: number;
        previewRows: PreviewTransactionRow[];
        detectedColumns: string[];
        warnings: string[];
      };
    }
  | {
      ok: true;
      kind: "holdings";
      summary: {
        fileName: string;
        importKind: "holdings";
        accountName: string;
        accountSubtype: string | null;
        bucket: keyof typeof ManualInvestmentBucket;
        isoCurrencyCode: string;
        rowCount: number;
        asOf: string;
        previewRows: PreviewHoldingRow[];
        detectedColumns: string[];
        warnings: string[];
      };
    };

type PreviewFailure = {
  ok: false;
  error: string;
};

export type ManualInvestmentImportPreview = PreviewSuccess | PreviewFailure;

export type ManualInvestmentImportCommitResult = {
  importKind: ManualInvestmentImportKind;
  account: {
    id: string;
    name: string;
    subtype: string | null;
    bucket: keyof typeof ManualInvestmentBucket;
    source: string;
  };
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  warnings: string[];
};

const DEFAULT_SOURCE = "fidelity_csv";
const DEFAULT_CURRENCY = "USD";

const TRANSACTION_HEADER_ALIASES = {
  date: ["date", "transaction date", "run date", "settlement date"],
  type: ["action", "type", "transaction type", "activity"],
  subtype: ["sub type", "subtype"],
  symbol: ["symbol", "ticker"],
  securityId: ["cusip", "security id"],
  name: ["description", "details", "security description", "investment name", "investment", "name"],
  quantity: ["quantity", "shares", "shares/unit", "shares units"],
  price: ["price", "share price"],
  fees: ["fees", "fee", "commission"],
  amount: ["amount", "net amount", "value", "transaction amount"]
} as const;

const HOLDING_HEADER_ALIASES = {
  securityName: ["description", "security description", "name", "investment name"],
  symbol: ["symbol", "ticker"],
  securityId: ["cusip", "security id"],
  quantity: ["quantity", "shares"],
  institutionPrice: ["last price", "current price", "price"],
  institutionValue: ["current value", "market value", "value", "total value"],
  costBasis: ["cost basis", "total cost basis", "cost basis total"]
} as const;

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[%$]/g, "")
    .replace(/[_/()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCell(value: string) {
  return value.replace(/\uFEFF/g, "").trim();
}

function parseCsv(content: string): ParsedCsvTable {
  const sanitizedContent = content.replace(/^\uFEFF/u, "");
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < sanitizedContent.length; index += 1) {
    const character = sanitizedContent[index] ?? "";
    const nextCharacter = sanitizedContent[index + 1] ?? "";

    if (character === "\"") {
      if (inQuotes && nextCharacter === "\"") {
        currentCell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      currentRow.push(currentCell);
      currentCell = "";

      if (currentRow.some((value) => value.trim().length > 0)) {
        rows.push(currentRow);
      }

      currentRow = [];
      continue;
    }

    currentCell += character;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    if (currentRow.some((value) => value.trim().length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length < 2) {
    throw new Error("The CSV needs a header row and at least one data row.");
  }

  const headers = rows[0]?.map(normalizeCell) ?? [];
  const normalizedHeaders = headers.map(normalizeHeader);
  const dataRows = rows.slice(1).map((values, index) => ({
    lineNumber: index + 2,
    values
  }));

  return {
    headers,
    normalizedHeaders,
    rows: dataRows
  };
}

function findHeaderIndex(
  normalizedHeaders: string[],
  aliases: readonly string[]
) {
  const normalizedAliases = aliases.map(normalizeHeader);
  const foundIndex = normalizedHeaders.findIndex((header) =>
    normalizedAliases.includes(header)
  );

  return foundIndex >= 0 ? foundIndex : null;
}

function requireHeader(
  normalizedHeaders: string[],
  aliases: readonly string[],
  label: string
) {
  const index = findHeaderIndex(normalizedHeaders, aliases);
  if (index === null) {
    throw new Error(`Could not find a "${label}" column in the CSV.`);
  }

  return index;
}

function optionalHeader(
  normalizedHeaders: string[],
  aliases: readonly string[]
) {
  return findHeaderIndex(normalizedHeaders, aliases);
}

function readCell(row: ParsedCsvRow, index: number | null) {
  if (index === null) {
    return "";
  }

  return normalizeCell(row.values[index] ?? "");
}

function parseDateValue(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Missing ${label}.`);
  }

  const isoCandidate = /^\d{4}-\d{2}-\d{2}$/u.test(trimmed)
    ? `${trimmed}T00:00:00.000Z`
    : trimmed;
  const parsed = new Date(isoCandidate);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Unrecognized ${label}: "${value}".`);
  }

  return parsed;
}

function parseDecimalString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/\((.+)\)/, "-$1");
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Unrecognized numeric value: "${value}".`);
  }

  return parsed.toFixed(2);
}

function parseQuantityString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed
    .replace(/,/g, "")
    .replace(/\((.+)\)/, "-$1");
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Unrecognized quantity value: "${value}".`);
  }

  return parsed.toFixed(8);
}

function toRawRow(
  headers: string[],
  row: ParsedCsvRow
): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((header, index) => {
    result[header] = normalizeCell(row.values[index] ?? "");
  });
  return result;
}

function createRowFingerprint(parts: Array<string | null | undefined>) {
  return createHash("sha256")
    .update(parts.map((part) => part ?? "").join("|"))
    .digest("hex");
}

function buildAccountKey(input: {
  userId: string;
  source: string;
  bucket: keyof typeof ManualInvestmentBucket;
  accountName: string;
  accountSubtype: string | null;
}) {
  return createHash("sha256")
    .update(
      [
        input.userId,
        input.source,
        input.bucket,
        input.accountName.trim().toLowerCase(),
        input.accountSubtype?.trim().toLowerCase() ?? ""
      ].join("|")
    )
    .digest("hex");
}

function parseTransactionsCsv(
  table: ParsedCsvTable,
  metadata: ImportMetadata
) {
  const dateIndex = requireHeader(table.normalizedHeaders, TRANSACTION_HEADER_ALIASES.date, "date");
  const typeIndex = requireHeader(table.normalizedHeaders, TRANSACTION_HEADER_ALIASES.type, "type");
  const amountIndex = requireHeader(table.normalizedHeaders, TRANSACTION_HEADER_ALIASES.amount, "amount");
  const nameIndex = requireHeader(table.normalizedHeaders, TRANSACTION_HEADER_ALIASES.name, "description");
  const subtypeIndex = optionalHeader(table.normalizedHeaders, TRANSACTION_HEADER_ALIASES.subtype);
  const symbolIndex = optionalHeader(table.normalizedHeaders, TRANSACTION_HEADER_ALIASES.symbol);
  const securityIdIndex = optionalHeader(table.normalizedHeaders, TRANSACTION_HEADER_ALIASES.securityId);
  const quantityIndex = optionalHeader(table.normalizedHeaders, TRANSACTION_HEADER_ALIASES.quantity);
  const priceIndex = optionalHeader(table.normalizedHeaders, TRANSACTION_HEADER_ALIASES.price);
  const feesIndex = optionalHeader(table.normalizedHeaders, TRANSACTION_HEADER_ALIASES.fees);

  const parsedRows: ParsedTransactionRow[] = [];
  const warnings: string[] = [];

  for (const row of table.rows) {
    try {
      const rawRow = toRawRow(table.headers, row);
      const date = parseDateValue(readCell(row, dateIndex), "transaction date");
      const type = readCell(row, typeIndex) || "activity";
      const name = readCell(row, nameIndex) || type;
      const subtype = readCell(row, subtypeIndex) || null;
      const symbol = readCell(row, symbolIndex) || null;
      const securityId = readCell(row, securityIdIndex) || null;
      const amount = parseDecimalString(readCell(row, amountIndex));
      const quantity = parseQuantityString(readCell(row, quantityIndex));
      const price = parseQuantityString(readCell(row, priceIndex));
      const fees = parseDecimalString(readCell(row, feesIndex));

      if (!amount) {
        warnings.push(`Skipped line ${row.lineNumber}: missing amount.`);
        continue;
      }

      parsedRows.push({
        rowFingerprint: createRowFingerprint([
          metadata.accountName,
          metadata.accountSubtype,
          date.toISOString(),
          type,
          subtype,
          symbol,
          name,
          amount,
          quantity,
          price,
          fees
        ]),
        date,
        name,
        type,
        subtype,
        symbol,
        securityId,
        amount,
        quantity,
        price,
        fees,
        isoCurrencyCode: metadata.isoCurrencyCode,
        rawRow
      });
    } catch (error) {
      warnings.push(
        `Skipped line ${row.lineNumber}: ${error instanceof Error ? error.message : "invalid transaction row"}.`
      );
    }
  }

  if (parsedRows.length === 0) {
    throw new Error("No transaction rows could be parsed from this CSV.");
  }

  return {
    rows: parsedRows,
    warnings,
    detectedColumns: table.headers
  };
}

function parseHoldingsCsv(
  table: ParsedCsvTable,
  metadata: ImportMetadata,
  asOfDate: string | null
) {
  const securityNameIndex = requireHeader(
    table.normalizedHeaders,
    HOLDING_HEADER_ALIASES.securityName,
    "security description"
  );
  const institutionValueIndex = requireHeader(
    table.normalizedHeaders,
    HOLDING_HEADER_ALIASES.institutionValue,
    "current value"
  );
  const symbolIndex = optionalHeader(table.normalizedHeaders, HOLDING_HEADER_ALIASES.symbol);
  const securityIdIndex = optionalHeader(
    table.normalizedHeaders,
    HOLDING_HEADER_ALIASES.securityId
  );
  const quantityIndex = optionalHeader(table.normalizedHeaders, HOLDING_HEADER_ALIASES.quantity);
  const priceIndex = optionalHeader(
    table.normalizedHeaders,
    HOLDING_HEADER_ALIASES.institutionPrice
  );
  const costBasisIndex = optionalHeader(table.normalizedHeaders, HOLDING_HEADER_ALIASES.costBasis);

  const snapshotDate = parseDateValue(
    asOfDate ?? new Date().toISOString().slice(0, 10),
    "holdings as-of date"
  );
  const parsedRows: ParsedHoldingRow[] = [];
  const warnings: string[] = [];

  for (const row of table.rows) {
    try {
      const rawRow = toRawRow(table.headers, row);
      const securityName = readCell(row, securityNameIndex);
      const symbol = readCell(row, symbolIndex) || null;
      const securityId = readCell(row, securityIdIndex) || null;
      const quantity = parseQuantityString(readCell(row, quantityIndex));
      const institutionPrice = parseQuantityString(readCell(row, priceIndex));
      const institutionValue = parseDecimalString(readCell(row, institutionValueIndex));
      const costBasis = parseDecimalString(readCell(row, costBasisIndex));

      if (!securityName || !institutionValue) {
        warnings.push(
          `Skipped line ${row.lineNumber}: missing security name or current value.`
        );
        continue;
      }

      parsedRows.push({
        rowFingerprint: createRowFingerprint([
          metadata.accountName,
          metadata.accountSubtype,
          snapshotDate.toISOString(),
          symbol,
          securityName,
          institutionValue,
          quantity,
          institutionPrice
        ]),
        asOf: snapshotDate,
        securityName,
        symbol,
        securityId,
        quantity,
        institutionPrice,
        institutionValue,
        costBasis,
        isoCurrencyCode: metadata.isoCurrencyCode,
        rawRow
      });
    } catch (error) {
      warnings.push(
        `Skipped line ${row.lineNumber}: ${error instanceof Error ? error.message : "invalid holding row"}.`
      );
    }
  }

  if (parsedRows.length === 0) {
    throw new Error("No holdings rows could be parsed from this CSV.");
  }

  return {
    rows: parsedRows,
    warnings,
    detectedColumns: table.headers,
    asOf: snapshotDate
  };
}

function sanitizeImportMetadata(input: {
  source?: string | null;
  accountName?: string | null;
  accountSubtype?: string | null;
  bucket?: string | null;
  isoCurrencyCode?: string | null;
}) {
  const accountName = input.accountName?.trim() ?? "";
  if (!accountName) {
    throw new Error("Account name is required for manual imports.");
  }

  const bucket = input.bucket?.trim() ?? "";
  if (!(bucket in ManualInvestmentBucket)) {
    throw new Error("Choose a valid investment bucket.");
  }

  return {
    source: input.source?.trim() || DEFAULT_SOURCE,
    accountName,
    accountSubtype: input.accountSubtype?.trim() || null,
    bucket: bucket as keyof typeof ManualInvestmentBucket,
    isoCurrencyCode: input.isoCurrencyCode?.trim() || DEFAULT_CURRENCY
  } satisfies ImportMetadata;
}

function previewRowsForTransactions(rows: ParsedTransactionRow[]): PreviewTransactionRow[] {
  return rows.slice(0, 8).map((row) => ({
    date: row.date.toISOString(),
    name: row.name,
    type: row.type,
    subtype: row.subtype,
    symbol: row.symbol,
    amount: row.amount,
    quantity: row.quantity,
    price: row.price,
    fees: row.fees
  }));
}

function previewRowsForHoldings(rows: ParsedHoldingRow[]): PreviewHoldingRow[] {
  return rows.slice(0, 8).map((row) => ({
    asOf: row.asOf.toISOString(),
    securityName: row.securityName,
    symbol: row.symbol,
    quantity: row.quantity,
    institutionPrice: row.institutionPrice,
    institutionValue: row.institutionValue,
    costBasis: row.costBasis
  }));
}

export function previewManualInvestmentImport(input: {
  fileName: string;
  csvContent: string;
  importKind: ManualInvestmentImportKind;
  accountName: string;
  accountSubtype?: string | null;
  bucket: string;
  isoCurrencyCode?: string | null;
  asOfDate?: string | null;
  source?: string | null;
}): ManualInvestmentImportPreview {
  try {
    const metadata = sanitizeImportMetadata(input);
    const table = parseCsv(input.csvContent);

    if (input.importKind === "transactions") {
      const parsed = parseTransactionsCsv(table, metadata);
      return {
        ok: true,
        kind: "transactions",
        summary: {
          fileName: input.fileName,
          importKind: "transactions",
          accountName: metadata.accountName,
          accountSubtype: metadata.accountSubtype,
          bucket: metadata.bucket,
          isoCurrencyCode: metadata.isoCurrencyCode,
          rowCount: parsed.rows.length,
          previewRows: previewRowsForTransactions(parsed.rows),
          detectedColumns: parsed.detectedColumns,
          warnings: parsed.warnings
        }
      };
    }

    const parsed = parseHoldingsCsv(table, metadata, input.asOfDate ?? null);
    return {
      ok: true,
      kind: "holdings",
      summary: {
        fileName: input.fileName,
        importKind: "holdings",
        accountName: metadata.accountName,
        accountSubtype: metadata.accountSubtype,
        bucket: metadata.bucket,
        isoCurrencyCode: metadata.isoCurrencyCode,
        rowCount: parsed.rows.length,
        asOf: parsed.asOf.toISOString(),
        previewRows: previewRowsForHoldings(parsed.rows),
        detectedColumns: parsed.detectedColumns,
        warnings: parsed.warnings
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to preview the CSV import."
    };
  }
}

export async function commitManualInvestmentImport(input: {
  fileName: string;
  csvContent: string;
  importKind: ManualInvestmentImportKind;
  accountName: string;
  accountSubtype?: string | null;
  bucket: string;
  isoCurrencyCode?: string | null;
  asOfDate?: string | null;
  source?: string | null;
}) {
  const metadata = sanitizeImportMetadata(input);
  const table = parseCsv(input.csvContent);
  const user = await getOrCreateDefaultUser();
  const accountKey = buildAccountKey({
    userId: user.id,
    ...metadata
  });

  const manualAccount = await prisma.manualInvestmentAccount.upsert({
    where: {
      accountKey
    },
    update: {
      name: metadata.accountName,
      subtype: metadata.accountSubtype,
      bucket: metadata.bucket,
      isoCurrencyCode: metadata.isoCurrencyCode,
      source: metadata.source,
      lastImportedAt: new Date()
    },
    create: {
      userId: user.id,
      accountKey,
      source: metadata.source,
      name: metadata.accountName,
      subtype: metadata.accountSubtype,
      bucket: metadata.bucket,
      isoCurrencyCode: metadata.isoCurrencyCode,
      lastImportedAt: new Date()
    }
  });

  if (input.importKind === "transactions") {
    const parsed = parseTransactionsCsv(table, metadata);
    const existingFingerprints = new Set(
      (
        await prisma.manualInvestmentTransaction.findMany({
          where: {
            manualInvestmentAccountId: manualAccount.id,
            rowFingerprint: {
              in: parsed.rows.map((row) => row.rowFingerprint)
            }
          },
          select: {
            rowFingerprint: true
          }
        })
      ).map((row) => row.rowFingerprint)
    );

    const rowsToCreate = parsed.rows.filter(
      (row) => !existingFingerprints.has(row.rowFingerprint)
    );

    if (rowsToCreate.length > 0) {
      await prisma.manualInvestmentTransaction.createMany({
        data: rowsToCreate.map((row) => ({
          userId: user.id,
          manualInvestmentAccountId: manualAccount.id,
          rowFingerprint: row.rowFingerprint,
          securityId: row.securityId,
          symbol: row.symbol,
          name: row.name,
          type: row.type,
          subtype: row.subtype,
          amount: row.amount,
          quantity: row.quantity,
          price: row.price,
          fees: row.fees,
          date: row.date,
          isoCurrencyCode: row.isoCurrencyCode,
          rawRow: row.rawRow
        }))
      });
    }

    return {
      importKind: "transactions",
      account: {
        id: manualAccount.id,
        name: manualAccount.name,
        subtype: manualAccount.subtype,
        bucket: manualAccount.bucket,
        source: manualAccount.source
      },
      rowCount: parsed.rows.length,
      importedCount: rowsToCreate.length,
      duplicateCount: parsed.rows.length - rowsToCreate.length,
      warnings: parsed.warnings
    } satisfies ManualInvestmentImportCommitResult;
  }

  const parsed = parseHoldingsCsv(table, metadata, input.asOfDate ?? null);
  await prisma.$transaction(async (transaction) => {
    await transaction.manualHoldingSnapshot.deleteMany({
      where: {
        manualInvestmentAccountId: manualAccount.id,
        asOf: parsed.asOf
      }
    });

    await transaction.manualHoldingSnapshot.createMany({
      data: parsed.rows.map((row) => ({
        userId: user.id,
        manualInvestmentAccountId: manualAccount.id,
        rowFingerprint: row.rowFingerprint,
        asOf: row.asOf,
        securityId: row.securityId,
        symbol: row.symbol,
        securityName: row.securityName,
        quantity: row.quantity,
        institutionPrice: row.institutionPrice,
        institutionValue: row.institutionValue,
        costBasis: row.costBasis,
        isoCurrencyCode: row.isoCurrencyCode,
        rawRow: row.rawRow
      }))
    });
  });

  return {
    importKind: "holdings",
    account: {
      id: manualAccount.id,
      name: manualAccount.name,
      subtype: manualAccount.subtype,
      bucket: manualAccount.bucket,
      source: manualAccount.source
    },
    rowCount: parsed.rows.length,
    importedCount: parsed.rows.length,
    duplicateCount: 0,
    warnings: parsed.warnings
  } satisfies ManualInvestmentImportCommitResult;
}
