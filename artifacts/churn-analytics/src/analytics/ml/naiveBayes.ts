import { average, sampleVariance } from "../profiling";
import { sigmoid } from "./utils";

export function gaussianNaiveBayes(
  train: number[][],
  labels: boolean[],
  test: number[][],
  balancedPrior = false,
): {
  predictions: number[];
  importance: Array<{ feature: number; importance: number }>;
} {
  const classes = [false, true];
  const stats = classes.map((label) => {
    const rows = train.filter((_, index) => labels[index] === label);
    return {
      prior: balancedPrior ? 0.5 : (rows.length + 1) / (train.length + 2),
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
