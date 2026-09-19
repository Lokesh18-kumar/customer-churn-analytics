import type { ColumnMeta, TargetInfo, Row } from "./types";
import { findColumn, normalized, text } from "./profiling";

export function detectChurnTarget(
  columns: string[],
  columnMeta: ColumnMeta[],
  paddedRows: Row[],
): {
  target: TargetInfo;
  targetCandidate?: ColumnMeta;
  churnFlags: boolean[];
  churned: number;
  retained: number;
  overallRate: number;
  hasDetectedTarget: boolean;
} {
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
  const retained = hasDetectedTarget ? paddedRows.length - churned : paddedRows.length;
  const overallRate = hasDetectedTarget && paddedRows.length ? churned / paddedRows.length : 0;

  const target: TargetInfo = {
    column: targetColumn || "Not detected",
    positiveLabel,
    negativeLabel,
    detected: hasDetectedTarget,
  };

  return {
    target,
    targetCandidate,
    churnFlags,
    churned,
    retained,
    overallRate,
    hasDetectedTarget,
  };
}
