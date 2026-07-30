import type { UsageRequestRecord } from "@t3tools/contracts";

export function deduplicateUsageRecords(
  records: ReadonlyArray<UsageRequestRecord>,
  existingIds: ReadonlySet<string> = new Set(),
): {
  readonly accepted: ReadonlyArray<UsageRequestRecord>;
  readonly duplicates: number;
} {
  const seen = new Set(existingIds);
  const accepted: UsageRequestRecord[] = [];
  let duplicates = 0;
  for (const record of records) {
    if (seen.has(record.id)) {
      duplicates += 1;
      continue;
    }
    seen.add(record.id);
    accepted.push(record);
  }
  return { accepted, duplicates };
}

export function estimateTextTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}
