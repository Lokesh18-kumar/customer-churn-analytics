import { round } from "../profiling";

export function metricsAtThreshold(labels: boolean[], scores: number[], threshold: number) {
  const predicted = scores.map((score) => score >= threshold);
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
  return {
    accuracy: round(accuracy),
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    predictedPositiveRate: round(predicted.filter(Boolean).length / Math.max(1, labels.length)),
    confusionMatrix: { truePositive, falsePositive, trueNegative, falseNegative },
  };
}

export function modelMetrics(labels: boolean[], scores: number[]) {
  const thresholdMetrics = metricsAtThreshold(labels, scores, 0.5);
  const positives = labels.filter(Boolean).length;
  const negatives = labels.length - positives;
  const ordered = scores.map((score, index) => ({ score, label: labels[index] ? 1 : 0 })).sort((a, b) => a.score - b.score);
  let rankSum = 0;
  ordered.forEach((item, index) => { if (item.label) rankSum += index + 1; });
  const rocAuc = positives && negatives ? (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives) : 0.5;
  return { ...thresholdMetrics, rocAuc: round(rocAuc) };
}
