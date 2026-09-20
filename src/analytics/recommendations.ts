import type { Breakdown, BreakdownRow, Correlation, Recommendation } from "./types";
import { MIN_SEGMENT_SAMPLE_SIZE, percentage, titleCase } from "./profiling";

export function buildInsights(
  hasDetectedTarget: boolean,
  rowsLength: number,
  overallRate: number,
  churned: number,
  segmentSource: Breakdown | undefined,
  segmentRows: BreakdownRow[],
  correlations: Correlation[],
  tenureColumn?: string,
  monthlyChargesColumn?: string,
  missingCells = 0,
  invalidValues = 0,
  duplicateRows = 0,
): string[] {
  const insights: string[] = [];
  if (!hasDetectedTarget) {
    insights.push("No churn-like target column was detected, so churn rates and risk findings are shown as unavailable until a target field is included.");
  } else if (rowsLength >= MIN_SEGMENT_SAMPLE_SIZE) {
    insights.push(`Overall churn is ${percentage(overallRate)}% (${churned.toLocaleString()} of ${rowsLength.toLocaleString()} customers).`);
    const evaluatedSegments = segmentRows.filter((row) => row.total >= MIN_SEGMENT_SAMPLE_SIZE);
    const highestRisk = evaluatedSegments
      .filter((row) => row.rate >= percentage(overallRate) + 5)
      .sort((a, b) => b.rate - a.rate)[0];
    if (highestRisk && highestRisk.rate > percentage(overallRate)) {
      insights.push(`${titleCase(segmentSource?.dimension ?? "Customer segment")} ${highestRisk.label} has the highest observed churn at ${highestRisk.rate}%, ${Number((highestRisk.rate - percentage(overallRate)).toFixed(1))} points above the dataset average.`);
    } else if (evaluatedSegments.length > 0) {
      insights.push(`No normalized segment with at least ${MIN_SEGMENT_SAMPLE_SIZE} customers exceeds the overall churn rate by the 5-point risk threshold.`);
    } else {
      insights.push(`No category segment met the minimum sample size of ${MIN_SEGMENT_SAMPLE_SIZE} customers for segment-level risk insights.`);
    }
    const strongest = correlations[0];
    if (strongest && Math.abs(strongest.value) >= 0.2) {
      insights.push(`${titleCase(strongest.feature)} has the strongest linear association with churn in this upload (r = ${strongest.value}); this is an association, not proof of causation.`);
    }
    if (tenureColumn && monthlyChargesColumn) {
      insights.push(`The dashboard compares ${titleCase(tenureColumn)} with ${titleCase(monthlyChargesColumn)} to surface whether early-tenure or high-charge clusters have different churn patterns.`);
    }
  } else {
    insights.push(`A churn target was detected, but the dataset has only ${rowsLength} observations, below the ${MIN_SEGMENT_SAMPLE_SIZE}-customer minimum for reliable segment insights.`);
  }
  if (missingCells || invalidValues || duplicateRows) {
    insights.push(`Data quality review found ${missingCells.toLocaleString()} missing cells, ${invalidValues.toLocaleString()} invalid typed values, and ${duplicateRows.toLocaleString()} duplicate rows before analysis.`);
  }
  return insights;
}

export function buildRecommendations(
  hasDetectedTarget: boolean,
  segmentSource: Breakdown | undefined,
  segmentRows: BreakdownRow[],
  overallRate: number,
  correlations: Correlation[],
): Recommendation[] {
  if (!hasDetectedTarget) {
    return [{
      problem: "A reliable churn target was not available.",
      evidence: "The upload does not contain a clearly detectable churn, attrition, exit, or cancellation field.",
      action: "Add a binary churn outcome column and re-upload to enable churn-specific recommendations.",
      objective: "Make the analysis evidence-backed and decision-ready.",
      segment: "All customers",
    }];
  }

  const result: Recommendation[] = [];
  const evaluatedRows = segmentRows.filter((row) => row.total >= MIN_SEGMENT_SAMPLE_SIZE);
  const riskThreshold = percentage(overallRate) + 5;
  const highRiskSegments = evaluatedRows
    .filter((row) => row.rate >= riskThreshold)
    .sort((a, b) => b.rate - a.rate);
  const highest = highRiskSegments[0];

  if (highest && segmentSource) {
    result.push({
      problem: `${titleCase(segmentSource.dimension)} ${highest.label} is the highest-churn validated group.`,
      evidence: `${highest.rate}% churn across ${highest.total.toLocaleString()} customers versus ${percentage(overallRate)}% overall; the group meets the ${MIN_SEGMENT_SAMPLE_SIZE}-customer minimum.`,
      action: "Prioritize a retention journey for this group, combining proactive outreach with a targeted service or plan review.",
      objective: "Reduce preventable churn in a sufficiently sized, normalized segment.",
      segment: `${titleCase(segmentSource.dimension)} ${highest.label}`,
    });
  } else if (evaluatedRows.length > 0 && segmentSource) {
    const topObserved = evaluatedRows.slice().sort((a, b) => b.rate - a.rate)[0];
    result.push({
      problem: `No evaluated ${titleCase(segmentSource.dimension)} segment exceeds the risk threshold.`,
      evidence: `${evaluatedRows.length} segment${evaluatedRows.length === 1 ? "" : "s"} met the ${MIN_SEGMENT_SAMPLE_SIZE}-customer minimum (highest observed: ${topObserved.label} at ${topObserved.rate}% churn across ${topObserved.total.toLocaleString()} customers), but none exceed the overall churn rate of ${percentage(overallRate)}% by the 5-point risk threshold (${riskThreshold.toFixed(1)}%).`,
      action: "Maintain baseline retention monitoring across all segments rather than deploying targeted segment-specific interventions.",
      objective: "Focus retention resources on departures that exceed the normal baseline risk threshold.",
      segment: `${titleCase(segmentSource.dimension)} (all evaluated segments)`,
    });
  } else {
    result.push({
      problem: "No category segment met the minimum sample size for a reliable risk recommendation.",
      evidence: `All normalized category groups have fewer than ${MIN_SEGMENT_SAMPLE_SIZE} customers, so single-customer or otherwise sparse groups were not treated as high risk.`,
      action: "Collect more observations before targeting a specific category with a retention intervention.",
      objective: "Avoid acting on unstable churn rates caused by small samples.",
      segment: "All customers",
    });
  }

  const strongest = correlations[0];
  if (strongest && Math.abs(strongest.value) >= 0.2) {
    result.push({
      problem: `${titleCase(strongest.feature)} is associated with churn in this dataset.`,
      evidence: `Correlation with the churn flag is r = ${strongest.value} (${strongest.strength}).`,
      action: "Use this field as a prioritization signal and validate the pattern with a controlled retention test.",
      objective: "Focus interventions where the strongest measured signal is present without treating it as causal.",
      segment: "Customers with elevated risk on this feature",
    });
  }

  return result;
}
