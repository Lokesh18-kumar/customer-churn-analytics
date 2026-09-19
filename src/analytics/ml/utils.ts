import { average, sampleVariance } from "../profiling";

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
}

export function standardize(train: number[][], test: number[][]) {
  const means = train[0]?.map((_, column) => average(train.map((row) => row[column] ?? 0))) ?? [];
  const deviations = means.map((mean, column) => Math.sqrt(sampleVariance(train.map((row) => row[column] ?? mean))) || 1);
  const transform = (rows: number[][]) => rows.map((row) => row.map((value, column) => ((value ?? means[column] ?? 0) - (means[column] ?? 0)) / (deviations[column] ?? 1)));
  return { train: transform(train), test: transform(test) };
}

export function gini(labels: boolean[]): number {
  if (!labels.length) return 0;
  const positive = labels.filter(Boolean).length / labels.length;
  return 1 - positive ** 2 - (1 - positive) ** 2;
}
