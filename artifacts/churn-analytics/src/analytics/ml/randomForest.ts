import type { TreeNode } from "./types";
import { gini, shuffle } from "./utils";

export function buildTree(
  rows: number[][],
  labels: boolean[],
  indices: number[],
  depth: number,
  random: () => number,
  importance: number[],
): TreeNode {
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

export function treePredict(node: TreeNode, row: number[]): number {
  if (node.probability !== undefined) return node.probability;
  return (row[node.feature ?? 0] ?? 0) <= (node.threshold ?? 0)
    ? treePredict(node.left ?? { probability: 0 }, row)
    : treePredict(node.right ?? { probability: 0 }, row);
}

export function randomForestPredict(
  train: number[][],
  labels: boolean[],
  test: number[][],
  random: () => number,
  balancedBootstrap = false,
): {
  predictions: number[];
  importance: number[];
} {
  const trees: TreeNode[] = [];
  const aggregateImportance = Array.from({ length: train[0]?.length ?? 0 }, () => 0);
  const positiveRows = labels.map((label, index) => label ? index : -1).filter((index) => index >= 0);
  const negativeRows = labels.map((label, index) => !label ? index : -1).filter((index) => index >= 0);
  for (let tree = 0; tree < 35; tree += 1) {
    const bootstrap = balancedBootstrap
      ? Array.from({ length: Math.max(1, Math.min(positiveRows.length, negativeRows.length) * 2) }, (_, index) => {
          const pool = index % 2 === 0 ? positiveRows : negativeRows;
          return pool[Math.floor(random() * pool.length)] ?? 0;
        })
      : Array.from({ length: train.length }, () => Math.floor(random() * train.length));
    trees.push(buildTree(train, labels, bootstrap, 0, random, aggregateImportance));
  }
  return {
    predictions: test.map((row) => trees.reduce((sum, tree) => sum + treePredict(tree, row), 0) / Math.max(1, trees.length)),
    importance: aggregateImportance,
  };
}
