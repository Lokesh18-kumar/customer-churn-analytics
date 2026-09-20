export type Cell = string | number | boolean | null;
export type Row = Cell[];

export interface ColumnMeta {
  name: string;
  values: Cell[];
  present: Cell[];
  type: "numeric" | "date" | "categorical";
  missing: number;
  unique: number;
  sample: string;
}

export interface AnalyzeRequest {
  fileName?: string;
  columns: string[];
  rows: (string | number | boolean | null)[][];
}

export interface ColumnStat {
  name: string;
  type: "numeric" | "date" | "categorical";
  missing: number;
  unique: number;
  sample: string;
}

export interface DataQuality {
  missingCells: number;
  duplicateRows: number;
  invalidValues: number;
  outlierCells: number;
  inconsistentCategories: number;
  highCardinality: string[];
  lowCardinality: string[];
  issues: string[];
  warnings: string[];
  minimumSegmentSampleSize: number;
  columnStats: ColumnStat[];
}

export interface DatasetOverview {
  rows: number;
  columns: number;
  churned: number;
  retained: number;
  churnRate: number;
  avgTenure: number;
  avgMonthlyCharges: number;
  numericColumns: string[];
  categoricalColumns: string[];
  dateColumns: string[];
}

export interface TargetInfo {
  column: string;
  positiveLabel: string;
  negativeLabel: string;
  detected: boolean;
}

export interface BreakdownRow {
  label: string;
  total: number;
  churned: number;
  rate: number;
  average: number;
  reliable: boolean;
}

export interface Breakdown {
  dimension: string;
  rows: BreakdownRow[];
}

export interface DistributionBin {
  label: string;
  churned: number;
  retained: number;
}

export interface ScatterPoint {
  x: number;
  y: number;
  churned: boolean;
}

export interface Correlation {
  feature: string;
  value: number;
  strength: string;
}

export interface Segment {
  name: string;
  customers: number;
  churnRate: number;
  avgCharges: number;
  avgTenure: number;
  characteristics: string;
  risk: "High risk" | "Stable" | "Watch" | string;
}

export interface Recommendation {
  problem: string;
  evidence: string;
  action: string;
  objective: string;
  segment: string;
}

export interface GroupRate {
  group: string;
  total: number;
  churned: number;
  churnRate: number;
  reliable?: boolean;
}

export interface StatisticalTest {
  feature: string;
  variableType: string;
  test: string;
  statisticName: string;
  statistic: number;
  pValue: number | null;
  adjustedPValue: number | null;
  effectSize: number | null;
  effectSizeMetric?: string;
  effectSizeLabel: string;
  significant: boolean;
  sampleSize?: number;
  groups: GroupRate[];
  notes: string;
}

export interface StatisticalAnalysis {
  tests: StatisticalTest[];
  correction: string;
  alpha: number;
  notes: string[];
}

export interface ConfusionMatrix {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
}

export interface FeatureImportance {
  feature: string;
  importance: number;
}

export interface ModelResult {
  model: string;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  rocAuc: number;
  confusionMatrix: ConfusionMatrix;
  featureImportance: FeatureImportance[];
  threshold?: number;
}

export interface ThresholdMetrics {
  model: string;
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
  predictedPositiveRate: number;
  confusionMatrix: ConfusionMatrix;
  accuracy?: number;
}

export interface ClassDistribution {
  positiveLabel?: string;
  positive: number;
  negative: number;
  positiveRate: number;
  imbalanceRatio: number;
}

export interface PrecisionRecallCurve {
  model: string;
  points: Array<{ threshold: number; precision: number; recall: number }>;
}

export interface PredictiveModeling {
  targetDetected: boolean;
  classDistribution: ClassDistribution;
  bestModel: string;
  trainSize: number;
  testSize: number;
  models: ModelResult[];
  adjustedModels: ModelResult[];
  thresholdAnalysis: ThresholdMetrics[];
  precisionRecallCurves: PrecisionRecallCurve[];
  recommendedModel: string;
  recommendedThreshold: number;
  selectionRationale: string;
  classImbalanceHandled: boolean;
  methodology: string[];
  leakageChecks: string[];
  notes: string[];
}

export interface AnalyzeResponse {
  fileName: string;
  overview: DatasetOverview;
  quality: DataQuality;
  target: TargetInfo;
  preview: Record<string, Cell>[];
  breakdowns: Breakdown[];
  distributions: Record<string, DistributionBin[]>;
  scatter: ScatterPoint[];
  correlations: Correlation[];
  segments: Segment[];
  insights: string[];
  recommendations: Recommendation[];
  transformations: string[];
  statisticalAnalysis: StatisticalAnalysis;
  predictiveModeling: PredictiveModeling;
  methodology: string[];
  limitations: string[];
}
