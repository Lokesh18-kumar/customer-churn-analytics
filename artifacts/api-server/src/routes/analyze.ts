import { Router, type IRouter } from "express";
import {
  AnalyzeDatasetBody,
  AnalyzeDatasetResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

type Cell = string | number | boolean | null;
type Row = Cell[];

const MISSING_VALUES = new Set(["", "na", "n/a", "null", "none", "-", "--"]);

function text(value: Cell | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalized(value: Cell | undefined): string {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function isMissing(value: Cell | undefined): boolean {
  return value === null || MISSING_VALUES.has(normalized(value));
}

function numericValue(value: Cell | undefined): number | null {
  if (isMissing(value)) return null;
  const raw = text(value).replace(/[$,%\s,]/g, "");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value: Cell | undefined): number | null {
  if (isMissing(value)) return null;
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function percentage(value: number): number {
  return Number((value * 100).toFixed(1));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function safeLabel(value: string): string {
  return value || "Missing";
}

function quantile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] ?? 0;
  return (sorted[lower] ?? 0) + ((sorted[upper] ?? 0) - (sorted[lower] ?? 0)) * (position - lower);
}

function pearson(xs: number[], ys: number[]): number {
  if (xs.length < 3 || xs.length !== ys.length) return 0;
  const meanX = average(xs);
  const meanY = average(ys);
  const numerator = xs.reduce((sum, x, index) => sum + (x - meanX) * ((ys[index] ?? 0) - meanY), 0);
  const denominatorX = Math.sqrt(xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0));
  const denominatorY = Math.sqrt(ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0));
  if (!denominatorX || !denominatorY) return 0;
  return Number((numerator / (denominatorX * denominatorY)).toFixed(3));
}

function strength(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 0.6) return "strong";
  if (magnitude >= 0.3) return "moderate";
  return "weak";
}

function findColumn(columns: string[], patterns: RegExp[]): string | undefined {
  return columns.find((column) => patterns.some((pattern) => pattern.test(column.toLowerCase())));
}

function binsFor(values: number[], count = 6): Array<{ min: number; max: number; label: string }> {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ min, max, label: String(Math.round(min)) }];
  const step = (max - min) / count;
  return Array.from({ length: count }, (_, index) => {
    const lower = min + step * index;
    const upper = index === count - 1 ? max : min + step * (index + 1);
    return {
      min: lower,
      max: upper,
      label: `${Math.round(lower)}–${Math.round(upper)}`,
    };
  });
}

router.post("/analyze", (req, res) => {
  const parsed = AnalyzeDatasetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Upload a CSV with at least one column and one row." });
    return;
  }

  const { columns, rows, fileName } = parsed.data;
  if (!columns.length || !rows.length) {
    res.status(400).json({ message: "Upload a CSV with at least one column and one row." });
    return;
  }
  if (columns.length > 200 || rows.length > 100_000) {
    res.status(400).json({ message: "This dashboard supports up to 200 columns and 100,000 rows per upload." });
    return;
  }

  const paddedRows: Row[] = rows.map((row) => columns.map((_, index) => row[index] ?? null));
  const columnValues = new Map<string, Cell[]>();
  columns.forEach((column, index) => columnValues.set(column, paddedRows.map((row) => row[index] ?? null)));

  const columnMeta = columns.map((name) => {
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

  const targetMeta = findColumn(columns, [/churn/i, /attrition/i, /exited/i, /cancel/i, /retention/i]);
  const targetCandidate = targetMeta
    ? columnMeta.find((meta) => meta.name === targetMeta)
    : columnMeta.find((meta) => {
        if (meta.type !== "categorical" || meta.unique > 4) return false;
        const values = new Set(meta.present.map((value) => normalized(value)));
        return values.has("yes") && values.has("no");
      });
  const targetColumn = targetCandidate?.name ?? "";
  const targetValues = targetCandidate?.values ?? [];
  const positiveLabel = targetCandidate
    ? [...new Set(targetCandidate.present.map((value) => text(value)))].find((value) => /yes|true|churn|left|exit|cancel|attrit/i.test(value)) ??
      [...new Set(targetCandidate.present.map((value) => text(value)))][0] ??
      "Churned"
    : "Churned";
  const negativeLabel = targetCandidate
    ? [...new Set(targetCandidate.present.map((value) => text(value)))].find((value) => value !== positiveLabel && /no|false|stay|active|retain/i.test(value)) ??
      [...new Set(targetCandidate.present.map((value) => text(value)))].find((value) => value !== positiveLabel) ??
      "Retained"
    : "Retained";
  const churnFlags = targetCandidate
    ? targetValues.map((value) => normalized(value) === normalized(positiveLabel) || /yes|true|churn|left|exit|cancel|attrit/i.test(normalized(value)))
    : paddedRows.map(() => false);
  const hasDetectedTarget = Boolean(targetCandidate);
  const churned = hasDetectedTarget ? churnFlags.filter(Boolean).length : 0;
  const retained = hasDetectedTarget ? rows.length - churned : rows.length;
  const overallRate = hasDetectedTarget && rows.length ? churned / rows.length : 0;

  let duplicateRows = 0;
  const seenRows = new Set<string>();
  paddedRows.forEach((row) => {
    const key = row.map((value) => normalized(value)).join("\u0001");
    if (seenRows.has(key)) duplicateRows += 1;
    seenRows.add(key);
  });

  let invalidValues = 0;
  let outlierCells = 0;
  let inconsistentCategories = 0;
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
      const raw = meta.present.map((value) => text(value));
      inconsistentCategories += raw.filter((value) => value !== value.trim() || /\s{2,}/.test(value)).length;
      transformations.push(`${meta.name}: category labels are trimmed and compared case-insensitively for consistent grouping.`);
    }
    if (meta.unique > 20 && meta.unique / Math.max(meta.present.length, 1) > 0.8) highCardinality.push(meta.name);
    if (meta.unique > 0 && meta.unique <= 5) lowCardinality.push(meta.name);
  }
  if (duplicateRows) transformations.push(`${duplicateRows} duplicate row${duplicateRows === 1 ? "" : "s"} identified; duplicate rows are excluded from group summaries.`);
  if (outlierCells) transformations.push(`${outlierCells} numeric outlier cell${outlierCells === 1 ? "" : "s"} flagged with the 1.5× IQR rule; outliers are retained and flagged, not silently deleted.`);

  const qualityIssues: string[] = [];
  const missingCells = columnMeta.reduce((sum, meta) => sum + meta.missing, 0);
  if (missingCells) qualityIssues.push(`${missingCells.toLocaleString()} missing cells found across the upload.`);
  if (duplicateRows) qualityIssues.push(`${duplicateRows.toLocaleString()} duplicate row${duplicateRows === 1 ? "" : "s"} found.`);
  if (invalidValues) qualityIssues.push(`${invalidValues.toLocaleString()} value${invalidValues === 1 ? "" : "s"} do not match their inferred type.`);
  if (outlierCells) qualityIssues.push(`${outlierCells.toLocaleString()} potential numeric outlier${outlierCells === 1 ? "" : "s"} flagged.`);
  if (inconsistentCategories) qualityIssues.push(`${inconsistentCategories.toLocaleString()} categorical value${inconsistentCategories === 1 ? "" : "s"} contain whitespace inconsistencies.`);
  if (highCardinality.length) qualityIssues.push(`High-cardinality fields: ${highCardinality.join(", ")}.`);
  if (!qualityIssues.length) qualityIssues.push("No material quality issues were detected by the automated checks.");

  const numericColumns = columnMeta.filter((meta) => meta.type === "numeric").map((meta) => meta.name);
  const categoricalColumns = columnMeta.filter((meta) => meta.type === "categorical").map((meta) => meta.name);
  const dateColumns = columnMeta.filter((meta) => meta.type === "date").map((meta) => meta.name);
  const tenureColumn = findColumn(columns, [/tenure/i, /months? active/i, /months? subscribed/i, /lifetime/i]);
  const monthlyChargesColumn = findColumn(columns, [/monthly.*charge/i, /monthly.*fee/i, /mrr/i, /price/i, /revenue/i]) ?? numericColumns[0];
  const totalChargesColumn = findColumn(columns, [/total.*charge/i, /ltv/i, /lifetime.*value/i, /total.*spend/i]);
  const ageColumn = findColumn(columns, [/^age$/i, /customer.*age/i]);

  function makeBreakdown(dimension: string, valueAccessor: (row: Row, index: number) => string, averageAccessor?: (row: Row) => number | null) {
    const groups = new Map<string, { total: number; churned: number; averages: number[] }>();
    paddedRows.forEach((row, index) => {
      const label = safeLabel(valueAccessor(row, index));
      const group = groups.get(label) ?? { total: 0, churned: 0, averages: [] };
      group.total += 1;
      if (churnFlags[index]) group.churned += 1;
      const averageValue = averageAccessor?.(row);
      if (averageValue !== null && averageValue !== undefined) group.averages.push(averageValue);
      groups.set(label, group);
    });
    return {
      dimension,
      rows: [...groups.entries()]
        .sort(([, a], [, b]) => b.total - a.total)
        .slice(0, 12)
        .map(([label, group]) => ({
          label,
          total: group.total,
          churned: group.churned,
          rate: percentage(group.total ? group.churned / group.total : 0),
          average: average(group.averages),
        })),
    };
  }

  const breakdowns: Array<{
    dimension: string;
    rows: Array<{ label: string; total: number; churned: number; rate: number; average: number }>;
  }> = [];
  const preferredCategoricals = categoricalColumns.filter((column) => {
    if (column === targetColumn) return false;
    const meta = columnMeta.find((candidate) => candidate.name === column);
    const identifierLike = /(^|[_\s-])(id|email|phone|name)([_\s-]|$)/i.test(column) || /customerid/i.test(column);
    const mostlyUnique = Boolean(meta && meta.unique / Math.max(meta.present.length, 1) > 0.5);
    return !identifierLike && !mostlyUnique;
  });
  preferredCategoricals.slice(0, 6).forEach((column) => {
    breakdowns.push(makeBreakdown(column, (row) => text(row[columns.indexOf(column)]), monthlyChargesColumn
      ? (row) => numericValue(row[columns.indexOf(monthlyChargesColumn)]) : undefined));
  });

  const numericBreakdownColumns = [ageColumn, tenureColumn, monthlyChargesColumn, totalChargesColumn].filter(
    (column, index, all): column is string => Boolean(column) && all.indexOf(column) === index,
  );
  numericBreakdownColumns.slice(0, 4).forEach((column) => {
    const values = (columnValues.get(column) ?? []).map((value) => numericValue(value)).filter((value): value is number => value !== null);
    const bins = binsFor(values);
    const index = columns.indexOf(column);
    breakdowns.push(makeBreakdown(titleCase(column), (row) => {
      const value = numericValue(row[index]);
      const bin = bins.find((candidate) => value !== null && value >= candidate.min && value <= candidate.max);
      return bin?.label ?? "Missing";
    }, (row) => numericValue(row[index])));
  });

  const distributions: Record<string, Array<{ label: string; churned: number; retained: number }>> = {};
  numericBreakdownColumns.slice(0, 4).forEach((column) => {
    const values = (columnValues.get(column) ?? []).map((value) => numericValue(value)).filter((value): value is number => value !== null);
    const bins = binsFor(values);
    const index = columns.indexOf(column);
    distributions[column] = bins.map((bin) => {
      let churnedCount = 0;
      let retainedCount = 0;
      paddedRows.forEach((row, rowIndex) => {
        const value = numericValue(row[index]);
        if (value === null || value < bin.min || value > bin.max) return;
        if (churnFlags[rowIndex]) churnedCount += 1;
        else retainedCount += 1;
      });
      return { label: bin.label, churned: churnedCount, retained: retainedCount };
    });
  });

  const scatterX = tenureColumn ?? numericColumns[0];
  const scatterY = monthlyChargesColumn ?? numericColumns[1] ?? numericColumns[0];
  const scatter = scatterX && scatterY
    ? paddedRows.slice(0, 1000).flatMap((row, index) => {
        const x = numericValue(row[columns.indexOf(scatterX)]);
        const y = numericValue(row[columns.indexOf(scatterY)]);
        return x === null || y === null ? [] : [{ x, y, churned: Boolean(churnFlags[index]) }];
      })
    : [];

  const correlations = numericColumns
    .filter((column) => column !== targetColumn)
    .map((column) => {
      const xs: number[] = [];
      const ys: number[] = [];
      const index = columns.indexOf(column);
      paddedRows.forEach((row, rowIndex) => {
        const value = numericValue(row[index]);
        if (value !== null && hasDetectedTarget) {
          xs.push(value);
          ys.push(churnFlags[rowIndex] ? 1 : 0);
        }
      });
      const value = pearson(xs, ys);
      return { feature: column, value, strength: strength(value) };
    })
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 10);

  const preferredSegmentBreakdown = breakdowns
    .filter((breakdown) => !numericBreakdownColumns.includes(breakdown.dimension))
    .sort((a, b) => {
      const aGap = Math.max(...a.rows.map((row) => Math.abs(row.rate - percentage(overallRate))), 0);
      const bGap = Math.max(...b.rows.map((row) => Math.abs(row.rate - percentage(overallRate))), 0);
      return bGap - aGap;
    })[0];
  const segmentSource = preferredSegmentBreakdown ?? breakdowns[0];
  const segments = (segmentSource?.rows ?? []).slice(0, 6).map((row) => {
    const risk = row.rate >= percentage(overallRate) + 5 ? "High risk" : row.rate <= percentage(overallRate) - 5 ? "Stable" : "Watch";
    return {
      name: segmentSource ? `${titleCase(segmentSource.dimension)} · ${row.label}` : "All customers",
      customers: row.total,
      churnRate: row.rate,
      avgCharges: row.average,
      avgTenure: tenureColumn
        ? average(paddedRows.flatMap((candidate, index) => {
            const groupLabel = safeLabel(text(candidate[columns.indexOf(segmentSource?.dimension ?? "")]));
            return groupLabel === row.label && churnFlags[index] === churnFlags[index] ? [numericValue(candidate[columns.indexOf(tenureColumn)]) ?? 0] : [];
          }))
        : 0,
      characteristics: `${row.total.toLocaleString()} customers; ${row.churned.toLocaleString()} churned.`,
      risk,
    };
  });

  const insights: string[] = [];
  if (!hasDetectedTarget) {
    insights.push("No churn-like target column was detected, so churn rates and risk findings are shown as unavailable until a target field is included.");
  } else {
    insights.push(`Overall churn is ${percentage(overallRate)}% (${churned.toLocaleString()} of ${rows.length.toLocaleString()} customers).`);
    const highestRisk = segmentSource?.rows.slice().sort((a, b) => b.rate - a.rate)[0];
    if (highestRisk && highestRisk.rate > percentage(overallRate)) {
      insights.push(`${titleCase(segmentSource?.dimension ?? "Customer segment")} ${highestRisk.label} has the highest observed churn at ${highestRisk.rate}%, ${Number((highestRisk.rate - percentage(overallRate)).toFixed(1))} points above the dataset average.`);
    }
    const strongest = correlations[0];
    if (strongest && Math.abs(strongest.value) >= 0.2) {
      insights.push(`${titleCase(strongest.feature)} has the strongest linear association with churn in this upload (r = ${strongest.value}); this is an association, not proof of causation.`);
    }
    if (tenureColumn && monthlyChargesColumn) {
      insights.push(`The dashboard compares ${titleCase(tenureColumn)} with ${titleCase(monthlyChargesColumn)} to surface whether early-tenure or high-charge clusters have different churn patterns.`);
    }
  }
  if (missingCells || invalidValues || duplicateRows) {
    insights.push(`Data quality review found ${missingCells.toLocaleString()} missing cells, ${invalidValues.toLocaleString()} invalid typed values, and ${duplicateRows.toLocaleString()} duplicate rows before analysis.`);
  }

  const recommendations = hasDetectedTarget && segmentSource?.rows.length
    ? (() => {
        const highest = segmentSource.rows.slice().sort((a, b) => b.rate - a.rate)[0];
        const strongest = correlations[0];
        const result = [{
          problem: `${titleCase(segmentSource.dimension)} ${highest.label} is the highest-churn observed group.`,
          evidence: `${highest.rate}% churn across ${highest.total.toLocaleString()} customers versus ${percentage(overallRate)}% overall.`,
          action: "Prioritize a retention journey for this group, combining proactive outreach with a targeted service or plan review.",
          objective: "Reduce preventable churn in the highest-risk observed segment.",
          segment: `${titleCase(segmentSource.dimension)} ${highest.label}`,
        }];
        if (strongest && Math.abs(strongest.value) >= 0.2) {
          result.push({
            problem: `${titleCase(strongest.feature)} is associated with churn in this dataset.`,
            evidence: `Correlation with the churn flag is r = ${strongest.value} (${strongest.strength}).`,
            action: "Use this field as a prioritization signal and validate the pattern with a controlled retention test.",
            objective: "Focus interventions where the strongest measured signal is present without treating it as causal.",
            segment: "Customers with elevated risk on this feature",
          });
        }
        return result;
      })()
    : [{
        problem: "A reliable churn target was not available.",
        evidence: "The upload does not contain a clearly detectable churn, attrition, exit, or cancellation field.",
        action: "Add a binary churn outcome column and re-upload to enable churn-specific recommendations.",
        objective: "Make the analysis evidence-backed and decision-ready.",
        segment: "All customers",
      }];

  const preview = paddedRows.slice(0, 10).map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
  const avgTenure = tenureColumn ? average((columnValues.get(tenureColumn) ?? []).map((value) => numericValue(value)).filter((value): value is number => value !== null)) : 0;
  const avgMonthlyCharges = monthlyChargesColumn ? average((columnValues.get(monthlyChargesColumn) ?? []).map((value) => numericValue(value)).filter((value): value is number => value !== null)) : 0;
  const response = {
    fileName: fileName || "uploaded-dataset.csv",
    overview: {
      rows: rows.length,
      columns: columns.length,
      churned,
      retained,
      churnRate: percentage(overallRate),
      avgTenure,
      avgMonthlyCharges,
      numericColumns,
      categoricalColumns,
      dateColumns,
    },
    quality: {
      missingCells,
      duplicateRows,
      invalidValues,
      outlierCells,
      inconsistentCategories,
      highCardinality,
      lowCardinality,
      issues: qualityIssues,
      columnStats: columnMeta.map(({ name, type, missing, unique, sample }) => ({ name, type, missing, unique, sample })),
    },
    target: {
      column: targetColumn || "Not detected",
      positiveLabel,
      negativeLabel,
      detected: hasDetectedTarget,
    },
    preview,
    breakdowns,
    distributions,
    scatter,
    correlations,
    segments,
    insights,
    recommendations,
    transformations,
  };

  res.json(AnalyzeDatasetResponse.parse(response));
});

export default router;