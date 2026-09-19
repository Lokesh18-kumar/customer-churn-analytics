import type { Breakdown, BreakdownRow, Row, Segment } from "./types";
import { average, normalized, numericValue, percentage, safeLabel, text, titleCase } from "./profiling";

export function buildSegments(
  columns: string[],
  paddedRows: Row[],
  churnFlags: boolean[],
  overallRate: number,
  breakdowns: Breakdown[],
  categoricalNormalizers: Map<string, Map<string, string>>,
  numericBreakdownColumns: string[],
  tenureColumn?: string,
): {
  segments: Segment[];
  segmentSource?: Breakdown;
  segmentRows: BreakdownRow[];
  excludedSmallGroups: string[];
} {
  const numericBreakdownDimensions = new Set(numericBreakdownColumns.map((column) => titleCase(column)));
  const eligibleBreakdowns = breakdowns
    .map((breakdown) => ({ ...breakdown, rows: breakdown.rows.filter((row) => row.reliable) }))
    .filter((breakdown) => breakdown.rows.length > 0 && !numericBreakdownDimensions.has(breakdown.dimension));

  const excludedSmallGroups = breakdowns.flatMap((breakdown) =>
    categoricalNormalizers.has(breakdown.dimension)
      ? breakdown.rows.filter((row) => !row.reliable).map((row) => `${breakdown.dimension} = ${row.label} (n=${row.total})`)
      : [],
  );

  const preferredSegmentBreakdown = eligibleBreakdowns
    .sort((a, b) => {
      const aGap = Math.max(...a.rows.map((row) => Math.abs(row.rate - percentage(overallRate))), 0);
      const bGap = Math.max(...b.rows.map((row) => Math.abs(row.rate - percentage(overallRate))), 0);
      return bGap - aGap;
    })[0];

  const segmentSource = preferredSegmentBreakdown ?? breakdowns[0];
  const segmentRows = segmentSource && segmentSource.rows.every((row) => row.reliable)
    ? segmentSource.rows
    : [];

  const segments: Segment[] = segmentRows.slice(0, 6).map((row) => {
    const risk = row.rate >= percentage(overallRate) + 5 ? "High risk" : row.rate <= percentage(overallRate) - 5 ? "Stable" : "Watch";
    const segmentNormalizer = categoricalNormalizers.get(segmentSource?.dimension ?? "");
    return {
      name: segmentSource ? `${titleCase(segmentSource.dimension)} · ${row.label}` : "All customers",
      customers: row.total,
      churnRate: row.rate,
      avgCharges: row.average,
      avgTenure: tenureColumn
        ? average(paddedRows.flatMap((candidate, index) => {
            const rawGroup = candidate[columns.indexOf(segmentSource?.dimension ?? "")];
            const groupLabel = segmentNormalizer?.get(normalized(rawGroup)) ?? safeLabel(text(rawGroup));
            return groupLabel === row.label && churnFlags[index] === churnFlags[index] ? [numericValue(candidate[columns.indexOf(tenureColumn)]) ?? 0] : [];
          }))
        : 0,
      characteristics: `${row.total.toLocaleString()} customers; ${row.churned.toLocaleString()} churned.`,
      risk,
    };
  });

  return { segments, segmentSource, segmentRows, excludedSmallGroups };
}
