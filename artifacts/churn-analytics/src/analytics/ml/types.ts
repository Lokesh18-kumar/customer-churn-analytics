export type RawFeature = number | string | null;

export interface FeatureSpec {
  name: string;
  column: string;
  type: "numeric" | "categorical";
}

export interface TreeNode {
  probability?: number;
  feature?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
}
