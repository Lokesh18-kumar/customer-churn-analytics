import { sigmoid } from "./utils";

export function logisticPredict(
  train: number[][],
  labels: boolean[],
  test: number[][],
  positiveWeight = 1,
  negativeWeight = 1,
): {
  predictions: number[];
  importance: Array<{ feature: number; importance: number }>;
} {
  const featureCount = train[0]?.length ?? 0;
  const weights = Array.from({ length: featureCount }, () => 0);
  let bias = Math.log(((labels.filter(Boolean).length * positiveWeight) + 1) / ((labels.filter((label) => !label).length * negativeWeight) + 1));
  const learningRate = 0.08;
  const regularization = 0.01;
  for (let epoch = 0; epoch < 450; epoch += 1) {
    const gradient = Array.from({ length: featureCount }, () => 0);
    let biasGradient = 0;
    train.forEach((row, index) => {
      const prediction = sigmoid(bias + row.reduce((sum, value, column) => sum + value * (weights[column] ?? 0), 0));
      const error = prediction - (labels[index] ? 1 : 0);
      const observationWeight = labels[index] ? positiveWeight : negativeWeight;
      biasGradient += error * observationWeight;
      row.forEach((value, column) => { gradient[column] += error * value * observationWeight; });
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
