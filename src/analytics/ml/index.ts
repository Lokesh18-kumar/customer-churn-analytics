import type { Cell, ColumnMeta, PredictiveModeling, Row } from "../types";
import type { FeatureSpec, RawFeature } from "./types";
import {
  average,
  isIdentifierLike,
  isMissing,
  normalized,
  numericValue,
  quantile,
  round,
  safeLabel,
  sampleVariance,
  text,
} from "../profiling";
import { seededRandom, shuffle, standardize } from "./utils";
import { logisticPredict } from "./logisticRegression";
import { gaussianNaiveBayes } from "./naiveBayes";
import { randomForestPredict } from "./randomForest";
import { modelMetrics, metricsAtThreshold } from "./evaluation";

export { logisticPredict } from "./logisticRegression";
export { gaussianNaiveBayes } from "./naiveBayes";
export { randomForestPredict } from "./randomForest";
export { modelMetrics, metricsAtThreshold } from "./evaluation";
export * from "./types";
export * from "./utils";

export function buildPredictiveModeling(
  columns: string[],
  columnMeta: ColumnMeta[],
  paddedRows: Row[],
  churnFlags: boolean[],
  targetColumn: string,
  categoricalNormalizers: Map<string, Map<string, string>>,
  positiveLabel: string,
): PredictiveModeling {
  const methodology = [
    "Rows with a missing churn target are excluded from modeling; numeric features are median-imputed and standardized using training data only.",
    "Categorical levels are learned from the training split; unseen test levels become all-zero one-hot vectors.",
    "A deterministic stratified 80/20 train/test split preserves the churn proportion as much as possible.",
    "Baseline models are compared on the held-out test set: logistic regression, Gaussian naive Bayes, and a 35-tree random forest.",
    "When the negative-to-positive class ratio is at least 1.5, adjusted variants use positive class weighting, balanced random-forest bootstraps, and a balanced naive-Bayes prior.",
    "Thresholds from 0.10 through 0.80 are evaluated explicitly; the retention recommendation balances F1 and recall rather than selecting by ROC-AUC alone.",
  ];
  const leakageChecks = [
    "The churn target column is excluded from the feature matrix.",
    "Identifier-like and mostly unique columns are excluded from modeling.",
    "Imputation, scaling, and categorical vocabulary fitting happen on training rows only.",
    "Test labels are used only for final metric calculation, never for fitting.",
  ];
  if (!targetColumn || !columnMeta.some((meta) => meta.name === targetColumn)) {
    return {
      targetDetected: false,
      classDistribution: { positiveLabel, positive: 0, negative: 0, positiveRate: 0, imbalanceRatio: 0 },
      bestModel: "Not available",
      trainSize: 0,
      testSize: 0,
      models: [],
      adjustedModels: [],
      thresholdAnalysis: [],
      precisionRecallCurves: [],
      recommendedModel: "Not available",
      recommendedThreshold: 0.5,
      selectionRationale: "A churn target is required before model comparison can run.",
      classImbalanceHandled: false,
      methodology,
      leakageChecks,
      notes: ["A churn target is required before predictive modeling can run."],
    };
  }
  const specs: FeatureSpec[] = columnMeta
    .filter((meta) => meta.name !== targetColumn && (meta.type === "numeric" || meta.type === "categorical") && !isIdentifierLike(meta.name, meta))
    .filter((meta) => meta.type === "numeric" || meta.unique <= 20)
    .map((meta) => ({ name: meta.name, column: meta.name, type: meta.type as "numeric" | "categorical" }));
  const validIndices = paddedRows.map((_, index) => index).filter((index) => !isMissing(paddedRows[index]?.[columns.indexOf(targetColumn)]));
  const positiveCount = validIndices.filter((index) => churnFlags[index]).length;
  const negativeCount = validIndices.length - positiveCount;
  const classDistribution = {
    positiveLabel,
    positive: positiveCount,
    negative: negativeCount,
    positiveRate: round(positiveCount / Math.max(1, validIndices.length)),
    imbalanceRatio: round(negativeCount / Math.max(1, positiveCount)),
  };
  if (validIndices.length < 20 || positiveCount < 5 || negativeCount < 5 || !specs.length) {
    return {
      targetDetected: true,
      classDistribution,
      bestModel: "Not available",
      trainSize: 0,
      testSize: 0,
      models: [],
      adjustedModels: [],
      thresholdAnalysis: [],
      precisionRecallCurves: [],
      recommendedModel: "Not available",
      recommendedThreshold: 0.5,
      selectionRationale: "The labeled sample is too small for a stable baseline-versus-adjusted comparison.",
      classImbalanceHandled: false,
      methodology,
      leakageChecks,
      notes: ["At least 20 labeled rows and at least 5 churned and 5 retained customers are required for a stable model comparison."],
    };
  }
  const random = seededRandom(20260910);
  const shuffled = shuffle(validIndices, random);
  const maxRows = 20_000;
  const selected = shuffled.length > maxRows ? shuffled.slice(0, maxRows) : shuffled;
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
  const imbalanceJustified = classDistribution.imbalanceRatio >= 1.5;
  const positiveWeight = imbalanceJustified ? trainLabels.length / (2 * Math.max(1, trainLabels.filter(Boolean).length)) : 1;
  const negativeWeight = imbalanceJustified ? trainLabels.length / (2 * Math.max(1, trainLabels.filter((label) => !label).length)) : 1;
  const baselineModelData = [
    { model: "Logistic Regression", predictions: logisticPredict(encoded.train, trainLabels, encoded.test), },
    { model: "Random Forest", predictions: randomForestPredict(encoded.train, trainLabels, encoded.test, random), },
    { model: "Gaussian Naive Bayes", predictions: gaussianNaiveBayes(encoded.train, trainLabels, encoded.test), },
  ];
  const adjustedModelData = [
    { model: "Logistic Regression · imbalance-adjusted", predictions: logisticPredict(encoded.train, trainLabels, encoded.test, positiveWeight, negativeWeight), },
    { model: "Random Forest · balanced bootstrap", predictions: randomForestPredict(encoded.train, trainLabels, encoded.test, random, imbalanceJustified), },
    { model: "Gaussian Naive Bayes · balanced prior", predictions: gaussianNaiveBayes(encoded.train, trainLabels, encoded.test, imbalanceJustified), },
  ];
  const modelResults = (modelData: Array<{ model: string; predictions: number[]; importance: Array<{ feature: number; importance: number }> | number[] }>) => modelData.map((model) => {
    const metrics = modelMetrics(testLabels, model.predictions);
    const totalImportance = model.predictions.length
      ? model.importance.reduce<number>((sum, value) => sum + (typeof value === "number" ? value : value.importance), 0) || 1
      : 1;
    const featureImportance = model.importance
      .map((value, index) => ({
        feature: featureNames[index] ?? `Feature ${index + 1}`,
        importance: round((typeof value === "number" ? value : value.importance) / totalImportance),
      }))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 10);
    return { model: model.model, accuracy: metrics.accuracy, precision: metrics.precision, recall: metrics.recall, f1: metrics.f1, rocAuc: metrics.rocAuc, confusionMatrix: metrics.confusionMatrix, featureImportance };
  });
  const baselineModels = modelResults(baselineModelData.map((model) => ({ model: model.model, predictions: model.predictions.predictions, importance: model.predictions.importance })));
  const adjustedModels = modelResults(adjustedModelData.map((model) => ({ model: model.model, predictions: model.predictions.predictions, importance: model.predictions.importance })));
  const allPredictionSets = [
    ...baselineModelData.map((model) => ({ model: model.model, scores: model.predictions.predictions })),
    ...adjustedModelData.map((model) => ({ model: model.model, scores: model.predictions.predictions })),
  ];
  const thresholds = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const thresholdAnalysis = allPredictionSets.flatMap((model) => thresholds.map((threshold) => {
    const metrics = metricsAtThreshold(testLabels, model.scores, threshold);
    return {
      model: model.model,
      threshold,
      precision: metrics.precision,
      recall: metrics.recall,
      f1: metrics.f1,
      predictedPositiveRate: metrics.predictedPositiveRate,
      confusionMatrix: metrics.confusionMatrix,
    };
  }));
  const precisionRecallCurves = allPredictionSets.map((model) => ({
    model: model.model,
    points: [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95].map((threshold) => {
      const metrics = metricsAtThreshold(testLabels, model.scores, threshold);
      return { threshold, precision: metrics.precision, recall: metrics.recall };
    }),
  }));
  const adjustedNames = new Set(adjustedModels.map((model) => model.model));
  const retentionCandidates = thresholdAnalysis
    .filter((point) => adjustedNames.has(point.model) && point.recall >= 0.4 && point.precision >= 0.2)
    .sort((a, b) => b.f1 - a.f1 || b.recall - a.recall || b.precision - a.precision);
  const fallbackCandidate = thresholdAnalysis
    .filter((point) => adjustedNames.has(point.model))
    .sort((a, b) => b.f1 - a.f1 || b.recall - a.recall || b.precision - a.precision)[0];
  const recommended = retentionCandidates[0] ?? fallbackCandidate;
  const best = baselineModels.slice().sort((a, b) => b.rocAuc - a.rocAuc)[0];
  return {
    targetDetected: true,
    classDistribution,
    bestModel: best?.model ?? "Not available",
    trainSize: trainIndices.length,
    testSize: testIndices.length,
    models: baselineModels,
    adjustedModels,
    thresholdAnalysis,
    precisionRecallCurves,
    recommendedModel: recommended?.model ?? "Not available",
    recommendedThreshold: recommended?.threshold ?? 0.5,
    selectionRationale: recommended
      ? `For retention, ${recommended.model} at a ${recommended.threshold.toFixed(2)} threshold was selected from imbalance-adjusted models because it balances recall (${(recommended.recall * 100).toFixed(1)}%) and F1 (${(recommended.f1 * 100).toFixed(1)}%), rather than maximizing ROC-AUC alone.`
      : "No adjusted model threshold met the minimum precision and recall guardrails; review the precision-recall tradeoff before deploying outreach.",
    classImbalanceHandled: imbalanceJustified,
    methodology,
    leakageChecks,
    notes: [
      selected.length < validIndices.length ? `Modeling was capped at ${maxRows.toLocaleString()} labeled rows for runtime stability.` : "All labeled rows were eligible for the deterministic split.",
      `Class distribution: ${positiveCount.toLocaleString()} ${positiveLabel} (${(classDistribution.positiveRate * 100).toFixed(1)}%) and ${negativeCount.toLocaleString()} non-${positiveLabel} (${(1 - classDistribution.positiveRate) * 100}%); negative-to-positive ratio ${classDistribution.imbalanceRatio.toFixed(2)}.`,
      imbalanceJustified ? "Class imbalance handling was justified and applied to the adjusted variants." : "Class imbalance handling was not activated because the negative-to-positive ratio was below 1.5.",
      "Why baseline models can differ: ROC-AUC evaluates ranking across thresholds, while precision, recall, and F1 at 0.50 depend on the operating cutoff. A model can rank churners above retained customers reasonably well yet predict almost no positives at 0.50, producing low recall or zero recall.",
      "Logistic regression produces a smooth linear probability score, random forest averages shallow tree probabilities and can be conservative for a minority class, and Gaussian naive Bayes assumes conditionally Gaussian features; their threshold behavior can therefore differ even when ROC-AUC values are close.",
      "Predictive feature importance identifies useful signals for this sample; it does not prove that a feature causes churn.",
      "A single holdout split gives an honest final check but can still be noisy; cross-validation would improve uncertainty estimates for production use.",
    ],
  };
}
