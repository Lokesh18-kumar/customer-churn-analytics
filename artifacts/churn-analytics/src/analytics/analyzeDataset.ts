import type {
  AnalyzeRequest,
  AnalyzeResponse,
  Breakdown,
  Cell,
  Correlation,
  DistributionBin,
  Row,
  ScatterPoint,
} from "./types";
import {
  average,
  binsFor,
  findColumn,
  MIN_SEGMENT_SAMPLE_SIZE,
  normalized,
  numericValue,
  pearson,
  percentage,
  profileCategoricalNormalizers,
  profileColumns,
  profileDataQuality,
  safeLabel,
  strength,
  text,
  titleCase,
} from "./profiling";
import { detectChurnTarget } from "./churnDetection";
import { buildStatisticalAnalysis } from "./statistics";
import { buildPredictiveModeling } from "./ml";
import { buildSegments } from "./segmentation";
import { buildInsights, buildRecommendations } from "./recommendations";

export async function analyzeDataset(request: AnalyzeRequest): Promise<AnalyzeResponse> {
  // Micro-task yield to ensure UI renders the loading state before intensive analysis runs
  await new Promise((resolve) => setTimeout(resolve, 10));

  const { columns, rows, fileName } = request;
  if (!columns || !columns.length || !rows || !rows.length) {
    throw new Error("Upload a CSV with at least one column and one row.");
  }
  if (columns.length > 200 || rows.length > 100_000) {
    throw new Error("This dashboard supports up to 200 columns and 100,000 rows per upload.");
  }

  const paddedRows: Row[] = rows.map((row) => columns.map((_, index) => row[index] ?? null));
  const { columnMeta, columnValues } = profileColumns(columns, paddedRows);
  const { categoricalNormalizers, inconsistentCategories, categoryWarningDetails } =
    profileCategoricalNormalizers(columnMeta);

  const {
    target,
    churnFlags,
    churned,
    retained,
    overallRate,
    hasDetectedTarget,
  } = detectChurnTarget(columns, columnMeta, paddedRows);

  const numericColumns = columnMeta.filter((meta) => meta.type === "numeric").map((meta) => meta.name);
  const categoricalColumns = columnMeta.filter((meta) => meta.type === "categorical").map((meta) => meta.name);
  const dateColumns = columnMeta.filter((meta) => meta.type === "date").map((meta) => meta.name);
  const targetColumn = target.column === "Not detected" ? "" : target.column;

  const tenureColumn = findColumn(columns, [/tenure/i, /months? active/i, /months? subscribed/i, /lifetime/i]);
  const monthlyChargesColumn = findColumn(columns, [/monthly.*charge/i, /monthly.*fee/i, /mrr/i, /price/i, /revenue/i]) ?? numericColumns[0];
  const totalChargesColumn = findColumn(columns, [/total.*charge/i, /ltv/i, /lifetime.*value/i, /total.*spend/i]);
  const ageColumn = findColumn(columns, [/^age$/i, /customer.*age/i]);

  function makeBreakdown(
    dimension: string,
    valueAccessor: (row: Row, index: number) => string,
    averageAccessor?: (row: Row) => number | null,
  ): Breakdown {
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
          reliable: group.total >= MIN_SEGMENT_SAMPLE_SIZE,
        })),
    };
  }

  const breakdowns: Breakdown[] = [];
  const preferredCategoricals = categoricalColumns.filter((column) => {
    if (column === targetColumn) return false;
    const meta = columnMeta.find((candidate) => candidate.name === column);
    const identifierLike = /(^|[_\s-])(id|email|phone|name)([_\s-]|$)/i.test(column) || /customerid/i.test(column);
    const mostlyUnique = Boolean(meta && meta.unique / Math.max(meta.present.length, 1) > 0.5);
    return !identifierLike && !mostlyUnique;
  });

  preferredCategoricals.slice(0, 6).forEach((column) => {
    const normalizer = categoricalNormalizers.get(column);
    breakdowns.push(
      makeBreakdown(
        column,
        (row) => normalizer?.get(normalized(row[columns.indexOf(column)])) ?? safeLabel(text(row[columns.indexOf(column)])),
        monthlyChargesColumn ? (row) => numericValue(row[columns.indexOf(monthlyChargesColumn)]) : undefined,
      ),
    );
  });

  const numericBreakdownColumns = [ageColumn, tenureColumn, monthlyChargesColumn, totalChargesColumn].filter(
    (column, index, all): column is string => Boolean(column) && all.indexOf(column) === index,
  );
  numericBreakdownColumns.slice(0, 4).forEach((column) => {
    const values = (columnValues.get(column) ?? []).map((value) => numericValue(value)).filter((value): value is number => value !== null);
    const bins = binsFor(values);
    const index = columns.indexOf(column);
    breakdowns.push(
      makeBreakdown(
        titleCase(column),
        (row) => {
          const value = numericValue(row[index]);
          const bin = bins.find((candidate) => value !== null && value >= candidate.min && value <= candidate.max);
          return bin?.label ?? "Missing";
        },
        (row) => numericValue(row[index]),
      ),
    );
  });

  const distributions: Record<string, DistributionBin[]> = {};
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
  const scatter: ScatterPoint[] =
    scatterX && scatterY
      ? paddedRows.slice(0, 1000).flatMap((row, index) => {
          const x = numericValue(row[columns.indexOf(scatterX)]);
          const y = numericValue(row[columns.indexOf(scatterY)]);
          return x === null || y === null ? [] : [{ x, y, churned: Boolean(churnFlags[index]) }];
        })
      : [];

  const correlations: Correlation[] = numericColumns
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
      if (xs.length < MIN_SEGMENT_SAMPLE_SIZE) return null;
      const value = pearson(xs, ys);
      return { feature: column, value, strength: strength(value) };
    })
    .filter((correlation): correlation is Correlation => correlation !== null)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 10);

  const { segments, segmentSource, segmentRows, excludedSmallGroups } = buildSegments(
    columns,
    paddedRows,
    churnFlags,
    overallRate,
    breakdowns,
    categoricalNormalizers,
    numericBreakdownColumns,
    tenureColumn,
  );

  const { dataQuality, transformations } = profileDataQuality(
    paddedRows,
    columnMeta,
    inconsistentCategories,
    categoryWarningDetails,
    excludedSmallGroups,
  );

  const insights = buildInsights(
    hasDetectedTarget,
    rows.length,
    overallRate,
    churned,
    segmentSource,
    segmentRows,
    correlations,
    tenureColumn,
    monthlyChargesColumn,
    dataQuality.missingCells,
    dataQuality.invalidValues,
    dataQuality.duplicateRows,
  );

  const recommendations = buildRecommendations(
    hasDetectedTarget,
    segmentSource,
    segmentRows,
    overallRate,
    correlations,
  );

  const statisticalAnalysis = hasDetectedTarget
    ? buildStatisticalAnalysis(columns, columnMeta, paddedRows, churnFlags, targetColumn, categoricalNormalizers)
    : {
        tests: [],
        correction: "Benjamini–Hochberg false discovery rate correction would apply once a churn target is detected.",
        alpha: 0.05,
        notes: ["No statistical tests were run because the upload does not contain a detectable binary churn target."],
      };

  const predictiveModeling = buildPredictiveModeling(
    columns,
    columnMeta,
    paddedRows,
    churnFlags,
    targetColumn,
    categoricalNormalizers,
    target.positiveLabel,
  );

  const methodology = [
    "Descriptive rates are calculated after categorical values are trimmed and normalized case-insensitively.",
    "Numeric churned-versus-retained comparisons use Welch's t-test with Cohen's d; categorical associations use Pearson's chi-square or Fisher's exact test when a 2×2 table has sparse expected counts.",
    "P-values are adjusted across estimable tests with the Benjamini–Hochberg false discovery rate procedure at α = 0.05.",
    "Predictive models use a deterministic stratified 80/20 holdout split, training-only preprocessing, and three classifiers: logistic regression, random forest, and Gaussian naive Bayes.",
  ];

  const limitations = [
    "Statistical significance is not practical significance; inspect effect sizes, churn-rate differences, and group sizes together.",
    "Correlation and association describe patterns in this observational dataset and do not establish causation.",
    "A single train/test split is appropriate for a transparent baseline but can produce noisy estimates; repeated cross-validation and confidence intervals would strengthen production validation.",
    "Small or sparse category groups are reported but excluded from risk recommendations and are not treated as reliable evidence.",
  ];

  const preview = paddedRows.slice(0, 10).map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
  const avgTenure = tenureColumn ? average((columnValues.get(tenureColumn) ?? []).map((value) => numericValue(value)).filter((value): value is number => value !== null)) : 0;
  const avgMonthlyCharges = monthlyChargesColumn ? average((columnValues.get(monthlyChargesColumn) ?? []).map((value) => numericValue(value)).filter((value): value is number => value !== null)) : 0;

  return {
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
    quality: dataQuality,
    target,
    preview,
    breakdowns,
    distributions,
    scatter,
    correlations,
    segments,
    insights,
    recommendations,
    transformations,
    statisticalAnalysis,
    predictiveModeling,
    methodology,
    limitations,
  };
}
