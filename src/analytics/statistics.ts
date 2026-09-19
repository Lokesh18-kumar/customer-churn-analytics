import type { Cell, ColumnMeta, Row, StatisticalAnalysis, StatisticalTest } from "./types";
import {
  average,
  isIdentifierLike,
  MIN_SEGMENT_SAMPLE_SIZE,
  normalized,
  numericValue,
  percentage,
  round,
  safeLabel,
  sampleVariance,
  text,
} from "./profiling";

export function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  const shifted = value - 1;
  let sum = 0.9999999999998099;
  coefficients.forEach((coefficient, index) => {
    sum += coefficient / (shifted + index + 1);
  });
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(sum);
}

export function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIterations = 200;
  const epsilon = 3e-7;
  const tiny = 1e-30;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const m2 = 2 * iteration;
    let aa = (iteration * (b - iteration) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = -((a + iteration) * (a + b + iteration) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const logPrefix = a * Math.log(x) + b * Math.log(1 - x) - logGamma(a) - logGamma(b) + logGamma(a + b);
  const prefix = Math.exp(logPrefix);
  if (x < (a + 1) / (a + b + 2)) {
    return prefix * betaContinuedFraction(x, a, b) / a;
  }
  return 1 - (prefix * betaContinuedFraction(1 - x, b, a)) / b;
}

export function studentTwoSidedP(tValue: number, degreesOfFreedom: number): number {
  if (!Number.isFinite(tValue) || degreesOfFreedom <= 0) return 1;
  const x = degreesOfFreedom / (degreesOfFreedom + tValue ** 2);
  return Math.min(1, Math.max(0, regularizedBeta(x, degreesOfFreedom / 2, 0.5)));
}

export function regularizedGammaQ(shape: number, value: number): number {
  if (value <= 0) return 1;
  if (value < shape + 1) {
    let term = 1 / shape;
    let sum = term;
    for (let index = 1; index <= 200; index += 1) {
      term *= value / (shape + index);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-10) break;
    }
    return Math.max(0, 1 - sum * Math.exp(-value + shape * Math.log(value) - logGamma(shape)));
  }
  let b = value + 1 - shape;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  for (let index = 1; index <= 200; index += 1) {
    const an = -index * (index - shape);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-10) break;
  }
  return Math.max(0, Math.min(1, Math.exp(-value + shape * Math.log(value) - logGamma(shape)) * h));
}

export function chiSquarePValue(statistic: number, degreesOfFreedom: number): number {
  return regularizedGammaQ(degreesOfFreedom / 2, statistic / 2);
}

export function logCombination(n: number, k: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

export function fisherExactTwoSided(a: number, b: number, c: number, d: number): number {
  const rowOne = a + b;
  const rowTwo = c + d;
  const columnOne = a + c;
  const total = rowOne + rowTwo;
  const observedLog = logCombination(rowOne, a) + logCombination(rowTwo, c) - logCombination(total, columnOne);
  const minimum = Math.max(0, columnOne - rowTwo);
  const maximum = Math.min(rowOne, columnOne);
  let probability = 0;
  for (let cell = minimum; cell <= maximum; cell += 1) {
    const logProbability = logCombination(rowOne, cell) + logCombination(rowTwo, columnOne - cell) - logCombination(total, columnOne);
    if (logProbability <= observedLog + 1e-10) probability += Math.exp(logProbability);
  }
  return Math.min(1, probability);
}

export function effectLabel(value: number | null): string {
  if (value === null) return "Not estimable";
  const magnitude = Math.abs(value);
  if (magnitude < 0.1) return "negligible";
  if (magnitude < 0.3) return "small";
  if (magnitude < 0.5) return "moderate";
  return "large";
}

export function welchTest(churnedValues: number[], retainedValues: number[]) {
  const churnedMean = average(churnedValues);
  const retainedMean = average(retainedValues);
  const churnedVariance = sampleVariance(churnedValues);
  const retainedVariance = sampleVariance(retainedValues);
  const standardError = Math.sqrt(churnedVariance / churnedValues.length + retainedVariance / retainedValues.length);
  const statistic = standardError ? (churnedMean - retainedMean) / standardError : 0;
  const numerator = (churnedVariance / churnedValues.length + retainedVariance / retainedValues.length) ** 2;
  const denominator =
    (churnedVariance ** 2) / (churnedValues.length ** 2 * Math.max(1, churnedValues.length - 1)) +
    (retainedVariance ** 2) / (retainedValues.length ** 2 * Math.max(1, retainedValues.length - 1));
  const degreesOfFreedom = denominator ? numerator / denominator : 1;
  const pooledStandardDeviation = Math.sqrt(
    ((churnedValues.length - 1) * churnedVariance + (retainedValues.length - 1) * retainedVariance) /
    Math.max(1, churnedValues.length + retainedValues.length - 2),
  );
  const effect = pooledStandardDeviation ? (churnedMean - retainedMean) / pooledStandardDeviation : null;
  return {
    statistic: round(statistic),
    pValue: round(studentTwoSidedP(statistic, degreesOfFreedom), 6),
    effectSize: effect === null ? null : round(effect),
    effectSizeLabel: effectLabel(effect),
    note: `Welch's t-test compares the mean of ${churnedValues.length} churned customers with ${retainedValues.length} retained customers; Cohen's d is the standardized mean difference.`,
  };
}

export function buildStatisticalAnalysis(
  columns: string[],
  columnMeta: ColumnMeta[],
  paddedRows: Row[],
  churnFlags: boolean[],
  targetColumn: string,
  categoricalNormalizers: Map<string, Map<string, string>>,
): StatisticalAnalysis {
  const tests: StatisticalTest[] = [];

  columnMeta.filter((meta) => meta.type === "numeric" && meta.name !== targetColumn).forEach((meta) => {
    const churnedValues: number[] = [];
    const retainedValues: number[] = [];
    const index = columns.indexOf(meta.name);
    paddedRows.forEach((row, rowIndex) => {
      const value = numericValue(row[index]);
      if (value === null) return;
      if (churnFlags[rowIndex]) churnedValues.push(value);
      else retainedValues.push(value);
    });
    if (churnedValues.length < 3 || retainedValues.length < 3) {
      tests.push({
        feature: meta.name,
        variableType: "numeric",
        test: "Welch's t-test",
        statisticName: "t",
        statistic: 0,
        pValue: null,
        adjustedPValue: null,
        effectSize: null,
        effectSizeLabel: "Not estimable",
        significant: false,
        sampleSize: churnedValues.length + retainedValues.length,
        groups: [],
        notes: "Not estimable: both churned and retained groups need at least 3 non-missing observations.",
      });
      return;
    }
    const result = welchTest(churnedValues, retainedValues);
    tests.push({
      feature: meta.name,
      variableType: "numeric",
      test: "Welch's t-test",
      statisticName: "t",
      statistic: result.statistic,
      pValue: result.pValue,
      adjustedPValue: null,
      effectSize: result.effectSize,
      effectSizeLabel: result.effectSizeLabel,
      significant: false,
      sampleSize: churnedValues.length + retainedValues.length,
      groups: [],
      notes: result.note,
    });
  });

  columnMeta
    .filter((meta) => meta.type === "categorical" && meta.name !== targetColumn && !isIdentifierLike(meta.name, meta) && meta.unique <= 50)
    .forEach((meta) => {
      const normalizer = categoricalNormalizers.get(meta.name);
      const grouped = new Map<string, { label: string; total: number; churned: number }>();
      const index = columns.indexOf(meta.name);
      paddedRows.forEach((row, rowIndex) => {
        const key = normalized(row[index]);
        if (!key) return;
        const group = grouped.get(key) ?? { label: normalizer?.get(key) ?? safeLabel(text(row[index])), total: 0, churned: 0 };
        group.total += 1;
        if (churnFlags[rowIndex]) group.churned += 1;
        grouped.set(key, group);
      });
      const groups = [...grouped.values()]
        .sort((a, b) => b.total - a.total)
        .slice(0, 20)
        .map((group) => ({
          group: group.label,
          total: group.total,
          churned: group.churned,
          churnRate: percentage(group.total ? group.churned / group.total : 0),
          reliable: group.total >= MIN_SEGMENT_SAMPLE_SIZE,
        }));
      if (groups.length < 2) return;
      const observed = groups.map((group) => [group.churned, group.total - group.churned]);
      const rowTotals = observed.map((row) => row[0] + row[1]);
      const columnTotals = [observed.reduce((sum, row) => sum + row[0], 0), observed.reduce((sum, row) => sum + row[1], 0)];
      const sampleSize = rowTotals.reduce((sum, value) => sum + value, 0);
      let chiSquare = 0;
      let expectedMinimum = Number.POSITIVE_INFINITY;
      observed.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
        const expected = (rowTotals[rowIndex] * (columnTotals[columnIndex] ?? 0)) / Math.max(1, sampleSize);
        expectedMinimum = Math.min(expectedMinimum, expected);
        if (expected > 0) chiSquare += (value - expected) ** 2 / expected;
      }));
      const degreesOfFreedom = groups.length - 1;
      const cramersV = sampleSize && degreesOfFreedom > 0
        ? Math.sqrt(chiSquare / (sampleSize * Math.min(degreesOfFreedom, 1)))
        : null;
      const isTwoByTwo = groups.length === 2;
      const sparseExpected = expectedMinimum < 5;
      let test = "Pearson chi-square test";
      let pValue: number | null = chiSquarePValue(chiSquare, Math.max(1, degreesOfFreedom));
      let notes = `Pearson's chi-square tests association between ${groups.length} normalized groups and the binary churn outcome. Cramer's V summarizes association strength.`;
      if (sparseExpected && isTwoByTwo) {
        test = "Fisher's exact test";
        pValue = fisherExactTwoSided(observed[0]?.[0] ?? 0, observed[0]?.[1] ?? 0, observed[1]?.[0] ?? 0, observed[1]?.[1] ?? 0);
        notes = "Fisher's exact test was used because the 2×2 table has low expected counts; Cramer's V is reported as the effect size.";
      } else if (sparseExpected) {
        test = "Chi-square not reliable";
        pValue = null;
        notes = "The contingency table has expected cell counts below 5, so a chi-square p-value is not reported for this sparse multi-group comparison.";
      }
      tests.push({
        feature: meta.name,
        variableType: "categorical",
        test,
        statisticName: "χ²",
        statistic: round(chiSquare),
        pValue: pValue === null ? null : round(pValue, 6),
        adjustedPValue: null,
        effectSize: cramersV === null ? null : round(cramersV),
        effectSizeLabel: effectLabel(cramersV),
        significant: false,
        sampleSize,
        groups,
        notes,
      });
    });

  const validTests = tests
    .map((test, index) => ({ test, index }))
    .filter(({ test }) => test.pValue !== null)
    .sort((a, b) => (a.test.pValue ?? 1) - (b.test.pValue ?? 1));
  let runningMinimum = 1;
  for (let rank = validTests.length - 1; rank >= 0; rank -= 1) {
    const item = validTests[rank];
    if (!item) continue;
    const adjusted = Math.min(runningMinimum, ((item.test.pValue ?? 1) * validTests.length) / (rank + 1));
    runningMinimum = adjusted;
    tests[item.index].adjustedPValue = round(adjusted, 6);
    tests[item.index].significant = adjusted < 0.05;
  }

  return {
    tests,
    correction: "Benjamini–Hochberg false discovery rate correction across all tests with estimable p-values.",
    alpha: 0.05,
    notes: [
      "Statistical significance is assessed using adjusted p-values below 0.05; it does not imply practical importance.",
      "Association and correlation do not establish causation. Observational CSV data cannot identify causal effects without a valid experimental design.",
      "Sparse categorical groups remain visible in group rates but are not treated as validated risk segments.",
    ],
  };
}
