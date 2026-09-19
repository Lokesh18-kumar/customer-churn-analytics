import type { Cell, Row, ColumnMeta, DataQuality } from "./types";

export const MISSING_VALUES = new Set(["", "na", "n/a", "null", "none", "-", "--"]);
export const MIN_SEGMENT_SAMPLE_SIZE = 5;

export function text(value: Cell | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function normalized(value: Cell | undefined): string {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

export function isMissing(value: Cell | undefined): boolean {
  return value === null || MISSING_VALUES.has(normalized(value));
}

export function numericValue(value: Cell | undefined): number | null {
  if (isMissing(value)) return null;
  const raw = text(value).replace(/[$,%\s,]/g, "");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function dateValue(value: Cell | undefined): number | null {
  if (isMissing(value)) return null;
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function percentage(value: number): number {
  return Number((value * 100).toFixed(1));
}

export function average(values: number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

export function safeLabel(value: string): string {
  return value || "Missing";
}

export function quantile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] ?? 0;
  return (sorted[lower] ?? 0) + ((sorted[upper] ?? 0) - (sorted[lower] ?? 0)) * (position - lower);
}

export function sampleVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

export function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function findColumn(columns: string[], patterns: RegExp[]): string | undefined {
  return columns.find((column) => patterns.some((pattern) => pattern.test(column.toLowerCase())));
}

export function binsFor(values: number[], count = 6): Array<{ min: number; max: number; label: string }> {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ min, max, label: String(Math.round(min)) }];
  const step = (max - min) / count;
  return Array.from({ length: count }, (_, index) => {
    const lower = min + step * index;
    const upper = index === count - 1 ? max : lower + step;
    return {
      min: lower,
      max: upper,
      label: `${Math.round(lower)}–${Math.round(upper)}`,
    };
  });
}

export function isIdentifierLike(column: string, meta?: { unique: number; present: Cell[] }): boolean {
  return /(^|[_\s-])(id|email|phone|name)([_\s-]|$)/i.test(column) ||
    /customerid/i.test(column) ||
    Boolean(meta && meta.unique / Math.max(meta.present.length, 1) > 0.8);
}

export function pearson(xs: number[], ys: number[]): number {
  if (xs.length < 3 || xs.length !== ys.length) return 0;
  const meanX = average(xs);
  const meanY = average(ys);
  const numerator = xs.reduce((sum, x, index) => sum + (x - meanX) * ((ys[index] ?? 0) - meanY), 0);
  const denominatorX = Math.sqrt(xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0));
  const denominatorY = Math.sqrt(ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0));
  if (!denominatorX || !denominatorY) return 0;
  return Number((numerator / (denominatorX * denominatorY)).toFixed(3));
}

export function strength(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 0.6) return "strong";
  if (magnitude >= 0.3) return "moderate";
  return "weak";
}

export function profileColumns(columns: string[], paddedRows: Row[]): {
  columnMeta: ColumnMeta[];
  columnValues: Map<string, Cell[]>;
} {
  const columnValues = new Map<string, Cell[]>();
  columns.forEach((column, index) => columnValues.set(column, paddedRows.map((row) => row[index] ?? null)));

  const columnMeta: ColumnMeta[] = columns.map((name) => {
    const values = columnValues.get(name) ?? [];
    const present = values.filter((value) => !isMissing(value));
    const numericCount = present.filter((value) => numericValue(value) !== null).length;
    const datesCount = present.filter((value) => dateValue(value) !== null).length;
    const numeric = present.length > 0 && numericCount / present.length >= 0.8;
    const dateHint = /(date|time|month|year|day|created|started|ended)/i.test(name);
    const date = !numeric && present.length > 0 && datesCount / present.length >= 0.8 && dateHint;
    const type = date ? "date" : numeric ? "numeric" : "categorical";
    const uniqueValues = new Set(present.map((value) => normalized(value)));
    return {
      name,
      values,
      present,
      type,
      missing: values.length - present.length,
      unique: uniqueValues.size,
      sample: present.slice(0, 3).map((value) => text(value)).join(", "),
    };
  });

  return { columnMeta, columnValues };
}

export function profileCategoricalNormalizers(
  columnMeta: ColumnMeta[],
): {
  categoricalNormalizers: Map<string, Map<string, string>>;
  inconsistentCategories: number;
  categoryWarningDetails: string[];
} {
  const categoricalNormalizers = new Map<string, Map<string, string>>();
  let inconsistentCategories = 0;
  const categoryWarningDetails: string[] = [];

  for (const meta of columnMeta.filter((candidate) => candidate.type === "categorical")) {
    const groups = new Map<string, { counts: Map<string, number>; rawForms: Set<string> }>();
    meta.present.forEach((value) => {
      const key = normalized(value);
      const group = groups.get(key) ?? { counts: new Map<string, number>(), rawForms: new Set<string>() };
      const trimmed = text(value);
      group.counts.set(trimmed, (group.counts.get(trimmed) ?? 0) + 1);
      group.rawForms.add(String(value));
      groups.set(key, group);
    });
    const normalizer = new Map<string, string>();
    groups.forEach((group, key) => {
      const canonical = [...group.counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? key;
      normalizer.set(key, canonical);
      if (group.counts.size > 1 || group.rawForms.size > 1) {
        const affectedCells = [...group.counts.values()].reduce((sum, count) => sum + count, 0);
        inconsistentCategories += affectedCells;
        const variants = [...group.rawForms].map((variant) => JSON.stringify(variant)).join(", ");
        categoryWarningDetails.push(`${meta.name}: ${variants} normalize to "${canonical}".`);
      }
    });
    categoricalNormalizers.set(meta.name, normalizer);
  }

  return { categoricalNormalizers, inconsistentCategories, categoryWarningDetails };
}

export function profileDataQuality(
  paddedRows: Row[],
  columnMeta: ColumnMeta[],
  inconsistentCategories: number,
  categoryWarningDetails: string[],
  excludedSmallGroups: string[] = [],
): {
  dataQuality: DataQuality;
  transformations: string[];
} {
  let duplicateRows = 0;
  const seenRows = new Set<string>();
  paddedRows.forEach((row) => {
    const key = row.map((value) => normalized(value)).join("\u0001");
    if (seenRows.has(key)) duplicateRows += 1;
    seenRows.add(key);
  });

  let invalidValues = 0;
  let outlierCells = 0;
  const highCardinality: string[] = [];
  const lowCardinality: string[] = [];
  const transformations: string[] = [
    "Original rows are preserved in the browser; analysis derives a cleaned view without overwriting the upload.",
  ];

  for (const meta of columnMeta) {
    if (meta.type === "numeric") {
      invalidValues += meta.present.filter((value) => numericValue(value) === null).length;
      const nums = meta.present.map((value) => numericValue(value)).filter((value): value is number => value !== null);
      if (nums.length >= 4) {
        const iqr = quantile(nums, 0.75) - quantile(nums, 0.25);
        const lower = quantile(nums, 0.25) - iqr * 1.5;
        const upper = quantile(nums, 0.75) + iqr * 1.5;
        outlierCells += nums.filter((value) => value < lower || value > upper).length;
      }
      transformations.push(`${meta.name}: numeric values are parsed with currency, commas, and percent signs ignored; missing values are excluded from aggregates.`);
    } else if (meta.type === "date") {
      invalidValues += meta.present.filter((value) => dateValue(value) === null).length;
      transformations.push(`${meta.name}: date values are parsed for profiling only; the uploaded text remains unchanged.`);
    } else {
      transformations.push(`${meta.name}: category labels are trimmed and compared case-insensitively for consistent grouping.`);
    }
    if (meta.unique > 20 && meta.unique / Math.max(meta.present.length, 1) > 0.8) highCardinality.push(meta.name);
    if (meta.unique > 0 && meta.unique <= 5) lowCardinality.push(meta.name);
  }
  if (duplicateRows) transformations.push(`${duplicateRows} duplicate row${duplicateRows === 1 ? "" : "s"} identified; duplicate rows are excluded from group summaries.`);
  if (outlierCells) transformations.push(`${outlierCells} numeric outlier cell${outlierCells === 1 ? "" : "s"} flagged with the 1.5× IQR rule; outliers are retained and flagged, not silently deleted.`);

  const missingCells = columnMeta.reduce((sum, meta) => sum + meta.missing, 0);
  const qualityIssues: string[] = [];
  if (missingCells) qualityIssues.push(`${missingCells.toLocaleString()} missing cells found across the upload.`);
  if (duplicateRows) qualityIssues.push(`${duplicateRows.toLocaleString()} duplicate row${duplicateRows === 1 ? "" : "s"} found.`);
  if (invalidValues) qualityIssues.push(`${invalidValues.toLocaleString()} value${invalidValues === 1 ? "" : "s"} do not match their inferred type.`);
  if (outlierCells) qualityIssues.push(`${outlierCells.toLocaleString()} potential numeric outlier${outlierCells === 1 ? "" : "s"} flagged.`);
  if (inconsistentCategories) qualityIssues.push(`${inconsistentCategories.toLocaleString()} categorical value${inconsistentCategories === 1 ? "" : "s"} use inconsistent casing or whitespace and were normalized before grouping.`);
  if (highCardinality.length) qualityIssues.push(`High-cardinality fields: ${highCardinality.join(", ")}.`);
  if (!qualityIssues.length) qualityIssues.push("No material quality issues were detected by the automated checks.");

  const qualityWarnings = [...categoryWarningDetails];
  if (categoryWarningDetails.length) {
    qualityWarnings.unshift(
      "Previous analysis issue: categorical spelling and casing variants were treated as separate groups, so a label such as FEMALE could appear to have 100% churn from only one raw-label row. Values are now normalized before statistics are calculated.",
    );
  }
  if (excludedSmallGroups.length) {
    qualityWarnings.push(
      `Excluded ${excludedSmallGroups.length} category group${excludedSmallGroups.length === 1 ? "" : "s"} from segment risk recommendations because each has fewer than ${MIN_SEGMENT_SAMPLE_SIZE} customers: ${excludedSmallGroups.slice(0, 8).join(", ")}${excludedSmallGroups.length > 8 ? ", …" : ""}.`,
    );
  }
  if (paddedRows.length < MIN_SEGMENT_SAMPLE_SIZE) {
    qualityWarnings.push(`The full dataset has ${paddedRows.length} customer${paddedRows.length === 1 ? "" : "s"}; at least ${MIN_SEGMENT_SAMPLE_SIZE} observations are required for segment-level insights.`);
  }

  const dataQuality: DataQuality = {
    missingCells,
    duplicateRows,
    invalidValues,
    outlierCells,
    inconsistentCategories,
    highCardinality,
    lowCardinality,
    issues: qualityIssues,
    warnings: qualityWarnings,
    minimumSegmentSampleSize: MIN_SEGMENT_SAMPLE_SIZE,
    columnStats: columnMeta.map(({ name, type, missing, unique, sample }) => ({ name, type, missing, unique, sample })),
  };

  return { dataQuality, transformations };
}
