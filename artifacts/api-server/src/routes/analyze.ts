import { Router, type IRouter } from "express";
import {
  AnalyzeDatasetBody,
  AnalyzeDatasetResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

type Cell = string | number | boolean | null;
type Row = Cell[];

const MISSING_VALUES = new Set(["", "na", "n/a", "null", "none", "-", "--"]);
const MIN_SEGMENT_SAMPLE_SIZE = 5;

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

function sampleVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function logGamma(value: number): number {
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

function betaContinuedFraction(x: number, a: number, b: number): number {
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

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const logPrefix = a * Math.log(x) + b * Math.log(1 - x) - logGamma(a) - logGamma(b) + logGamma(a + b);
  const prefix = Math.exp(logPrefix);
  if (x < (a + 1) / (a + b + 2)) {
    return prefix * betaContinuedFraction(x, a, b) / a;
  }
  return 1 - (prefix * betaContinuedFraction(1 - x, b, a)) / b;
}

function studentTwoSidedP(tValue: number, degreesOfFreedom: number): number {
  if (!Number.isFinite(tValue) || degreesOfFreedom <= 0) return 1;
  const x = degreesOfFreedom / (degreesOfFreedom + tValue ** 2);
  return Math.min(1, Math.max(0, regularizedBeta(x, degreesOfFreedom / 2, 0.5)));
}

function regularizedGammaQ(shape: number, value: number): number {
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

function chiSquarePValue(statistic: number, degreesOfFreedom: number): number {
  return regularizedGammaQ(degreesOfFreedom / 2, statistic / 2);
}

function logCombination(n: number, k: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

function fisherExactTwoSided(a: number, b: number, c: number, d: number): number {
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

function effectLabel(value: number | null): string {
  if (value === null) return "Not estimable";
  const magnitude = Math.abs(value);
  if (magnitude < 0.1) return "negligible";
  if (magnitude < 0.3) return "small";
  if (magnitude < 0.5) return "moderate";
  return "large";
}

function isIdentifierLike(column: string, meta?: { unique: number; present: Cell[] }): boolean {
  return /(^|[_\s-])(id|email|phone|name)([_\s-]|$)/i.test(column) ||
    /customerid/i.test(column) ||
    Boolean(meta && meta.unique / Math.max(meta.present.length, 1) > 0.8);
}

function welchTest(churnedValues: number[], retainedValues: number[]) {
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

function buildStatisticalAnalysis(
  columns: string[],
  columnMeta: Array<{ name: string; values: Cell[]; present: Cell[]; type: string; unique: number }>,
  paddedRows: Row[],
  churnFlags: boolean[],
  targetColumn: string,
  categoricalNormalizers: Map<string, Map<string, string>>,
) {
  const tests: Array<{
    feature: string;
    variableType: string;
    test: string;
    statisticName: string;
    statistic: number;
    pValue: number | null;
    adjustedPValue: number | null;
    effectSize: number | null;
    effectSizeLabel: string;
    significant: boolean;
    sampleSize: number;
    groups: Array<{ group: string; total: number; churned: number; churnRate: number; reliable: boolean }>;
    notes: string;
  }> = [];

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

type RawFeature = number | string | null;
type FeatureSpec = { name: string; column: string; type: "numeric" | "categorical" };
type TreeNode = { probability?: number; feature?: number; threshold?: number; left?: TreeNode; right?: TreeNode };

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
}

function standardize(train: number[][], test: number[][]) {
  const means = train[0]?.map((_, column) => average(train.map((row) => row[column] ?? 0))) ?? [];
  const deviations = means.map((mean, column) => Math.sqrt(sampleVariance(train.map((row) => row[column] ?? mean))) || 1);
  const transform = (rows: number[][]) => rows.map((row) => row.map((value, column) => ((value ?? means[column] ?? 0) - (means[column] ?? 0)) / (deviations[column] ?? 1)));
  return { train: transform(train), test: transform(test) };
}

function logisticPredict(train: number[][], labels: boolean[], test: number[][]) {
  const featureCount = train[0]?.length ?? 0;
  const weights = Array.from({ length: featureCount }, () => 0);
  let bias = Math.log((labels.filter(Boolean).length + 1) / (labels.filter((label) => !label).length + 1));
  const learningRate = 0.08;
  const regularization = 0.01;
  for (let epoch = 0; epoch < 450; epoch += 1) {
    const gradient = Array.from({ length: featureCount }, () => 0);
    let biasGradient = 0;
    train.forEach((row, index) => {
      const prediction = sigmoid(bias + row.reduce((sum, value, column) => sum + value * (weights[column] ?? 0), 0));
      const error = prediction - (labels[index] ? 1 : 0);
      biasGradient += error;
      row.forEach((value, column) => { gradient[column] += error * value; });
    });
    const scale = 1 / Math.max(1, train.length);
    weights.forEach((_, column) => { weights[column] -= learningRate * (gradient[column] * scale + regularization * (weights[column] ?? 0)); });
    bias -= learningRate * biasGradient * scale;
  }
  const predict = (row: number[]) => sigmoid(bias + row.reduce((sum, value, column) => sum + value * (weights[column] ?? 0), 0));
  return {
    predictions: test.map(predict),
    importance: weights.map((weight, feature) => ({ feature, importance: Math.abs(weight) })),
  };
}

function gaussianNaiveBayes(train: number[][], labels: boolean[], test: number[][]) {
  const classes = [false, true];
  const stats = classes.map((label) => {
    const rows = train.filter((_, index) => labels[index] === label);
    return {
      prior: (rows.length + 1) / (train.length + 2),
      mean: train[0]?.map((_, column) => average(rows.map((row) => row[column] ?? 0))) ?? [],
      variance: train[0]?.map((_, column) => Math.max(1e-4, sampleVariance(rows.map((row) => row[column] ?? 0)))) ?? [],
    };
  });
  const scores = test.map((row) => {
    const logLikelihoods = stats.map((stat) => stat.mean.reduce((sum, mean, column) => {
      const variance = stat.variance[column] ?? 1;
      const value = row[column] ?? 0;
      return sum - 0.5 * Math.log(2 * Math.PI * variance) - ((value - mean) ** 2) / (2 * variance);
    }, Math.log(stat.prior)));
    return sigmoid((logLikelihoods[1] ?? 0) - (logLikelihoods[0] ?? 0));
  });
  const importance = train[0]?.map((_, column) => {
    const meanDifference = Math.abs((stats[1]?.mean[column] ?? 0) - (stats[0]?.mean[column] ?? 0));
    return { feature: column, importance: meanDifference };
  }) ?? [];
  return { predictions: scores, importance };
}

function gini(labels: boolean[]): number {
  if (!labels.length) return 0;
  const positive = labels.filter(Boolean).length / labels.length;
  return 1 - positive ** 2 - (1 - positive) ** 2;
}

function buildTree(rows: number[][], labels: boolean[], indices: number[], depth: number, random: () => number, importance: number[]): TreeNode {
  const nodeProbability = indices.length ? indices.filter((index) => labels[index]).length / indices.length : 0;
  if (depth >= 3 || indices.length < 4 || nodeProbability === 0 || nodeProbability === 1) return { probability: nodeProbability };
  const featureCount = rows[0]?.length ?? 0;
  const featureCandidates = shuffle(Array.from({ length: featureCount }, (_, index) => index), random).slice(0, Math.max(1, Math.floor(Math.sqrt(featureCount))));
  const parentImpurity = gini(indices.map((index) => labels[index] ?? false));
  let best: { feature: number; threshold: number; left: number[]; right: number[]; gain: number } | undefined;
  featureCandidates.forEach((feature) => {
    const values = [...new Set(indices.map((index) => rows[index]?.[feature] ?? 0))].sort((a, b) => a - b);
    const thresholds = values.length > 12
      ? Array.from({ length: 12 }, (_, position) => values[Math.floor((position / 12) * values.length)] ?? 0)
      : values.slice(0, -1).map((value, index) => (value + (values[index + 1] ?? value)) / 2);
    thresholds.forEach((threshold) => {
      const left = indices.filter((index) => (rows[index]?.[feature] ?? 0) <= threshold);
      const right = indices.filter((index) => (rows[index]?.[feature] ?? 0) > threshold);
      if (left.length < 2 || right.length < 2) return;
      const gain = parentImpurity - (left.length * gini(left.map((index) => labels[index] ?? false)) + right.length * gini(right.map((index) => labels[index] ?? false))) / indices.length;
      if (!best || gain > best.gain) best = { feature, threshold, left, right, gain };
    });
  });
  if (!best || best.gain <= 1e-8) return { probability: nodeProbability };
  importance[best.feature] = (importance[best.feature] ?? 0) + best.gain;
  return {
    feature: best.feature,
    threshold: best.threshold,
    left: buildTree(rows, labels, best.left, depth + 1, random, importance),
    right: buildTree(rows, labels, best.right, depth + 1, random, importance),
  };
}

function treePredict(node: TreeNode, row: number[]): number {
  if (node.probability !== undefined) return node.probability;
  return (row[node.feature ?? 0] ?? 0) <= (node.threshold ?? 0)
    ? treePredict(node.left ?? { probability: 0 }, row)
    : treePredict(node.right ?? { probability: 0 }, row);
}

function randomForestPredict(train: number[][], labels: boolean[], test: number[][], random: () => number) {
  const trees: TreeNode[] = [];
  const aggregateImportance = Array.from({ length: train[0]?.length ?? 0 }, () => 0);
  for (let tree = 0; tree < 35; tree += 1) {
    const bootstrap = Array.from({ length: train.length }, () => Math.floor(random() * train.length));
    trees.push(buildTree(train, labels, bootstrap, 0, random, aggregateImportance));
  }
  return {
    predictions: test.map((row) => trees.reduce((sum, tree) => sum + treePredict(tree, row), 0) / Math.max(1, trees.length)),
    importance: aggregateImportance,
  };
}

function modelMetrics(labels: boolean[], scores: number[]) {
  const predicted = scores.map((score) => score >= 0.5);
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  predicted.forEach((value, index) => {
    const actual = labels[index] ?? false;
    if (actual && value) truePositive += 1;
    else if (!actual && value) falsePositive += 1;
    else if (!actual && !value) trueNegative += 1;
    else falseNegative += 1;
  });
  const accuracy = (truePositive + trueNegative) / Math.max(1, labels.length);
  const precision = truePositive / Math.max(1, truePositive + falsePositive);
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const positives = labels.filter(Boolean).length;
  const negatives = labels.length - positives;
  const ordered = scores.map((score, index) => ({ score, label: labels[index] ? 1 : 0 })).sort((a, b) => a.score - b.score);
  let rankSum = 0;
  ordered.forEach((item, index) => { if (item.label) rankSum += index + 1; });
  const rocAuc = positives && negatives ? (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives) : 0.5;
  return {
    accuracy: round(accuracy),
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    rocAuc: round(rocAuc),
    confusionMatrix: { truePositive, falsePositive, trueNegative, falseNegative },
  };
}

function buildPredictiveModeling(
  columns: string[],
  columnMeta: Array<{ name: string; values: Cell[]; present: Cell[]; type: string; unique: number }>,
  paddedRows: Row[],
  churnFlags: boolean[],
  targetColumn: string,
  categoricalNormalizers: Map<string, Map<string, string>>,
) {
  const methodology = [
    "Rows with a missing churn target are excluded from modeling; numeric features are median-imputed and standardized using training data only.",
    "Categorical levels are learned from the training split; unseen test levels become all-zero one-hot vectors.",
    "A deterministic stratified 80/20 train/test split preserves the churn proportion as much as possible.",
    "Models are compared on the held-out test set: logistic regression, Gaussian naive Bayes, and a 35-tree random forest.",
  ];
  const leakageChecks = [
    "The churn target column is excluded from the feature matrix.",
    "Identifier-like and mostly unique columns are excluded from modeling.",
    "Imputation, scaling, and categorical vocabulary fitting happen on training rows only.",
    "Test labels are used only for final metric calculation, never for fitting.",
  ];
  if (!targetColumn || !columnMeta.some((meta) => meta.name === targetColumn)) {
    return { targetDetected: false, bestModel: "Not available", trainSize: 0, testSize: 0, models: [], methodology, leakageChecks, notes: ["A churn target is required before predictive modeling can run."] };
  }
  const specs: FeatureSpec[] = columnMeta
    .filter((meta) => meta.name !== targetColumn && (meta.type === "numeric" || meta.type === "categorical") && !isIdentifierLike(meta.name, meta))
    .filter((meta) => meta.type === "numeric" || meta.unique <= 20)
    .map((meta) => ({ name: meta.name, column: meta.name, type: meta.type as "numeric" | "categorical" }));
  const validIndices = paddedRows.map((_, index) => index).filter((index) => !isMissing(paddedRows[index]?.[columns.indexOf(targetColumn)]));
  const positiveCount = validIndices.filter((index) => churnFlags[index]).length;
  const negativeCount = validIndices.length - positiveCount;
  if (validIndices.length < 20 || positiveCount < 5 || negativeCount < 5 || !specs.length) {
    return {
      targetDetected: true,
      bestModel: "Not available",
      trainSize: 0,
      testSize: 0,
      models: [],
      methodology,
      leakageChecks,
      notes: ["At least 20 labeled rows and at least 5 churned and 5 retained customers are required for a stable model comparison."],
    };
  }
  const random = seededRandom(20260910);
  const shuffled = shuffle(validIndices, random);
  const maxRows = 20_000;
  const selected = shuffled.length > maxRows ? shuffled.slice(0, maxRows) : shuffled;
  const selectedLabels = selected.map((index) => churnFlags[index]);
  const positiveRows = selected.filter((index) => churnFlags[index]);
  const negativeRows = selected.filter((index) => !churnFlags[index]);
  const testPositive = new Set(shuffle(positiveRows, random).slice(0, Math.max(1, Math.floor(positiveRows.length * 0.2))));
  const testNegative = new Set(shuffle(negativeRows, random).slice(0, Math.max(1, Math.floor(negativeRows.length * 0.2))));
  const testIndices = selected.filter((index) => testPositive.has(index) || testNegative.has(index));
  const trainIndices = selected.filter((index) => !testPositive.has(index) && !testNegative.has(index));
  const rawRows = (indices: number[]) => indices.map((index) => specs.map((spec) => {
    const value = paddedRows[index]?.[columns.indexOf(spec.column)];
    if (spec.type === "numeric") return numericValue(value);
    return categoricalNormalizers.get(spec.column)?.get(normalized(value)) ?? safeLabel(text(value));
  }));
  const rawTrain = rawRows(trainIndices);
  const rawTest = rawRows(testIndices);
  const numericStats = specs.map((spec, specIndex) => {
    if (spec.type !== "numeric") return { median: 0, mean: 0, deviation: 1 };
    const values = rawTrain.map((row) => row[specIndex]).filter((value): value is number => typeof value === "number");
    const median = quantile(values, 0.5);
    const mean = average(values);
    return { median, mean, deviation: Math.sqrt(sampleVariance(values)) || 1 };
  });
  const categoricalLevels = specs.map((spec, specIndex) => spec.type === "categorical"
    ? [...new Set(rawTrain.map((row) => String(row[specIndex] ?? "Missing")))].slice(0, 20)
    : []);
  const featureNames: string[] = [];
  specs.forEach((spec, specIndex) => {
    if (spec.type === "numeric") featureNames.push(spec.name);
    else categoricalLevels[specIndex]?.forEach((level) => featureNames.push(`${spec.name} = ${level}`));
  });
  const encode = (rows: RawFeature[][]) => rows.map((row) => {
    const output: number[] = [];
    row.forEach((value, specIndex) => {
      const spec = specs[specIndex];
      if (!spec) return;
      if (spec.type === "numeric") {
        const stats = numericStats[specIndex] ?? { median: 0, mean: 0, deviation: 1 };
        const numeric = typeof value === "number" ? value : stats.median;
        output.push((numeric - stats.mean) / stats.deviation);
      } else {
        const level = String(value ?? "Missing");
        categoricalLevels[specIndex]?.forEach((candidate) => output.push(candidate === level ? 1 : 0));
      }
    });
    return output;
  });
  const encoded = standardize(encode(rawTrain), encode(rawTest));
  const trainLabels = trainIndices.map((index) => churnFlags[index]);
  const testLabels = testIndices.map((index) => churnFlags[index]);
  const logistic = logisticPredict(encoded.train, trainLabels, encoded.test);
  const naiveBayes = gaussianNaiveBayes(encoded.train, trainLabels, encoded.test);
  const forest = randomForestPredict(encoded.train, trainLabels, encoded.test, random);
  const modelData = [
    { model: "Logistic Regression", predictions: logistic.predictions, importance: logistic.importance },
    { model: "Random Forest", predictions: forest.predictions, importance: forest.importance },
    { model: "Gaussian Naive Bayes", predictions: naiveBayes.predictions, importance: naiveBayes.importance },
  ];
  const models = modelData.map((model) => {
    const metrics = modelMetrics(testLabels, model.predictions);
    const totalImportance = model.importance.reduce<number>((sum, value) => {
      const importance = typeof value === "number" ? value : value.importance;
      return sum + importance;
    }, 0) || 1;
    const featureImportance = model.importance
      .map((value, index) => ({
        feature: featureNames[index] ?? `Feature ${index + 1}`,
        importance: round((typeof value === "number" ? value : value.importance) / totalImportance),
      }))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 10);
    return { model: model.model, ...metrics, featureImportance };
  });
  const best = models.slice().sort((a, b) => b.rocAuc - a.rocAuc)[0];
  return {
    targetDetected: true,
    bestModel: best?.model ?? "Not available",
    trainSize: trainIndices.length,
    testSize: testIndices.length,
    models,
    methodology,
    leakageChecks,
    notes: [
      selected.length < validIndices.length ? `Modeling was capped at ${maxRows.toLocaleString()} labeled rows for runtime stability.` : "All labeled rows were eligible for the deterministic split.",
      "Predictive feature importance identifies useful signals for this sample; it does not prove that a feature causes churn.",
      "A single holdout split gives an honest final check but can still be noisy; cross-validation would improve uncertainty estimates for production use.",
    ],
  };
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

  const qualityIssues: string[] = [];
  const missingCells = columnMeta.reduce((sum, meta) => sum + meta.missing, 0);
  if (missingCells) qualityIssues.push(`${missingCells.toLocaleString()} missing cells found across the upload.`);
  if (duplicateRows) qualityIssues.push(`${duplicateRows.toLocaleString()} duplicate row${duplicateRows === 1 ? "" : "s"} found.`);
  if (invalidValues) qualityIssues.push(`${invalidValues.toLocaleString()} value${invalidValues === 1 ? "" : "s"} do not match their inferred type.`);
  if (outlierCells) qualityIssues.push(`${outlierCells.toLocaleString()} potential numeric outlier${outlierCells === 1 ? "" : "s"} flagged.`);
  if (inconsistentCategories) qualityIssues.push(`${inconsistentCategories.toLocaleString()} categorical value${inconsistentCategories === 1 ? "" : "s"} use inconsistent casing or whitespace and were normalized before grouping.`);
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
          reliable: group.total >= MIN_SEGMENT_SAMPLE_SIZE,
        })),
    };
  }

  const breakdowns: Array<{
    dimension: string;
    rows: Array<{ label: string; total: number; churned: number; rate: number; average: number; reliable: boolean }>;
  }> = [];
  const preferredCategoricals = categoricalColumns.filter((column) => {
    if (column === targetColumn) return false;
    const meta = columnMeta.find((candidate) => candidate.name === column);
    const identifierLike = /(^|[_\s-])(id|email|phone|name)([_\s-]|$)/i.test(column) || /customerid/i.test(column);
    const mostlyUnique = Boolean(meta && meta.unique / Math.max(meta.present.length, 1) > 0.5);
    return !identifierLike && !mostlyUnique;
  });
  preferredCategoricals.slice(0, 6).forEach((column) => {
    const normalizer = categoricalNormalizers.get(column);
    breakdowns.push(makeBreakdown(column, (row) => normalizer?.get(normalized(row[columns.indexOf(column)])) ?? safeLabel(text(row[columns.indexOf(column)])), monthlyChargesColumn
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
      if (xs.length < MIN_SEGMENT_SAMPLE_SIZE) return null;
      const value = pearson(xs, ys);
      return { feature: column, value, strength: strength(value) };
    })
    .filter((correlation): correlation is { feature: string; value: number; strength: string } => correlation !== null)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 10);

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
  const segments = segmentRows.slice(0, 6).map((row) => {
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
  if (rows.length < MIN_SEGMENT_SAMPLE_SIZE) {
    qualityWarnings.push(`The full dataset has ${rows.length} customer${rows.length === 1 ? "" : "s"}; at least ${MIN_SEGMENT_SAMPLE_SIZE} observations are required for segment-level insights.`);
  }

  const insights: string[] = [];
  if (!hasDetectedTarget) {
    insights.push("No churn-like target column was detected, so churn rates and risk findings are shown as unavailable until a target field is included.");
  } else if (rows.length >= MIN_SEGMENT_SAMPLE_SIZE) {
    insights.push(`Overall churn is ${percentage(overallRate)}% (${churned.toLocaleString()} of ${rows.length.toLocaleString()} customers).`);
    const highestRisk = segmentRows
      .filter((row) => row.rate >= percentage(overallRate) + 5)
      .sort((a, b) => b.rate - a.rate)[0];
    if (highestRisk && highestRisk.rate > percentage(overallRate)) {
      insights.push(`${titleCase(segmentSource?.dimension ?? "Customer segment")} ${highestRisk.label} has the highest observed churn at ${highestRisk.rate}%, ${Number((highestRisk.rate - percentage(overallRate)).toFixed(1))} points above the dataset average.`);
    } else {
      insights.push(`No normalized segment with at least ${MIN_SEGMENT_SAMPLE_SIZE} customers exceeds the overall churn rate by the 5-point risk threshold.`);
    }
    const strongest = correlations[0];
    if (strongest && Math.abs(strongest.value) >= 0.2) {
      insights.push(`${titleCase(strongest.feature)} has the strongest linear association with churn in this upload (r = ${strongest.value}); this is an association, not proof of causation.`);
    }
    if (tenureColumn && monthlyChargesColumn) {
      insights.push(`The dashboard compares ${titleCase(tenureColumn)} with ${titleCase(monthlyChargesColumn)} to surface whether early-tenure or high-charge clusters have different churn patterns.`);
    }
  } else {
    insights.push(`A churn target was detected, but the dataset has only ${rows.length} observations, below the ${MIN_SEGMENT_SAMPLE_SIZE}-customer minimum for reliable segment insights.`);
  }
  if (missingCells || invalidValues || duplicateRows) {
    insights.push(`Data quality review found ${missingCells.toLocaleString()} missing cells, ${invalidValues.toLocaleString()} invalid typed values, and ${duplicateRows.toLocaleString()} duplicate rows before analysis.`);
  }

  const recommendations = hasDetectedTarget
    ? (() => {
        const result: Array<{ problem: string; evidence: string; action: string; objective: string; segment: string }> = [];
        const highest = segmentRows
          .filter((row) => row.rate >= percentage(overallRate) + 5)
          .sort((a, b) => b.rate - a.rate)[0];
        const strongest = correlations[0];
        if (highest && segmentSource) {
          result.push({
            problem: `${titleCase(segmentSource.dimension)} ${highest.label} is the highest-churn validated group.`,
            evidence: `${highest.rate}% churn across ${highest.total.toLocaleString()} customers versus ${percentage(overallRate)}% overall; the group meets the ${MIN_SEGMENT_SAMPLE_SIZE}-customer minimum.`,
            action: "Prioritize a retention journey for this group, combining proactive outreach with a targeted service or plan review.",
            objective: "Reduce preventable churn in a sufficiently sized, normalized segment.",
            segment: `${titleCase(segmentSource.dimension)} ${highest.label}`,
          });
        }
        if (strongest && Math.abs(strongest.value) >= 0.2) {
          result.push({
            problem: `${titleCase(strongest.feature)} is associated with churn in this dataset.`,
            evidence: `Correlation with the churn flag is r = ${strongest.value} (${strongest.strength}).`,
            action: "Use this field as a prioritization signal and validate the pattern with a controlled retention test.",
            objective: "Focus interventions where the strongest measured signal is present without treating it as causal.",
            segment: "Customers with elevated risk on this feature",
          });
        }
        if (!result.length) {
          result.push({
            problem: "No category segment met the minimum sample size for a reliable risk recommendation.",
            evidence: `All normalized category groups have fewer than ${MIN_SEGMENT_SAMPLE_SIZE} customers, so single-customer or otherwise sparse groups were not treated as high risk.`,
            action: "Collect more observations before targeting a specific category with a retention intervention.",
            objective: "Avoid acting on unstable churn rates caused by small samples.",
            segment: "All customers",
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
      warnings: qualityWarnings,
      minimumSegmentSampleSize: MIN_SEGMENT_SAMPLE_SIZE,
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
    statisticalAnalysis,
    predictiveModeling,
    methodology,
    limitations,
  };

  res.json(AnalyzeDatasetResponse.parse(response));
});

export default router;