import { buildRecommendations, buildInsights } from "../src/analytics/recommendations";
import { buildSegments } from "../src/analytics/segmentation";
import { analyzeDataset } from "../src/analytics/analyzeDataset";
import type { Breakdown, BreakdownRow, Correlation } from "../src/analytics/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

console.log("=========================================================");
console.log("TESTING RECOMMENDATIONS & SEGMENTATION LOGIC");
console.log("=========================================================\n");

// -----------------------------------------------------------------------------
// Test Case 1: The user's exact case
// - Overall churn = 13.5%
// - Contract segments:
//   - Month-to-month: 665 customers, 16.2% churn
//   - One year: 284 customers, 9.5% churn
//   - Two year: 261 customers, 10.7% churn
// -----------------------------------------------------------------------------
console.log("[Case 1] User's exact scenario: Month-to-month (665, 16.2%), One year (284, 9.5%), Two year (261, 10.7%), overall 13.5%");

const contractBreakdown: Breakdown = {
  dimension: "Contract",
  rows: [
    { label: "Month-to-month", total: 665, churned: 108, rate: 16.2, average: 75.5, reliable: true },
    { label: "One year", total: 284, churned: 27, rate: 9.5, average: 65.0, reliable: true },
    { label: "Two year", total: 261, churned: 28, rate: 10.7, average: 60.0, reliable: true },
  ],
};

const overallRate = 0.135; // 13.5%
const noCorrelations: Correlation[] = [];

const recommendationsCase1 = buildRecommendations(
  true,
  contractBreakdown,
  contractBreakdown.rows,
  overallRate,
  noCorrelations,
);

assert(recommendationsCase1.length === 1, "Expected exactly 1 recommendation for Contract dimension");
const rec1 = recommendationsCase1[0];

assert(!rec1.problem.includes("fewer than 5 customers"), "Must NOT claim groups have fewer than 5 customers");
assert(!rec1.evidence.includes("All normalized category groups have fewer than 5 customers"), "Must NOT claim all groups are sparse");
assert(rec1.problem.includes("No evaluated Contract segment exceeds the risk threshold"), `Problem text should state no segment exceeds risk threshold (got: "${rec1.problem}")`);
assert(rec1.evidence.includes("3 segments met the 5-customer minimum"), `Evidence should mention 3 evaluated segments (got: "${rec1.evidence}")`);
assert(rec1.evidence.includes("Month-to-month at 16.2% churn across 665 customers"), `Evidence should cite Month-to-month 16.2% across 665 customers (got: "${rec1.evidence}")`);
assert(rec1.evidence.includes("18.5%"), `Evidence should cite 18.5% risk threshold (got: "${rec1.evidence}")`);
assert(rec1.action.includes("Maintain baseline retention monitoring"), `Action should recommend baseline monitoring (got: "${rec1.action}")`);

// Check insights for Case 1
const insightsCase1 = buildInsights(
  true,
  1210,
  overallRate,
  163,
  contractBreakdown,
  contractBreakdown.rows,
  noCorrelations,
);
assert(
  insightsCase1.some((i) => i.includes("No normalized segment with at least 5 customers exceeds the overall churn rate by the 5-point risk threshold")),
  "Insights should correctly report that segments were evaluated but none exceed the 5-point threshold",
);

// -----------------------------------------------------------------------------
// Test Case 2: Genuinely high-risk segment
// - Overall churn = 13.5% (threshold = 18.5%)
// - Month-to-month: 665 customers, 25.0% churn (25.0% >= 18.5%) -> High Risk!
// -----------------------------------------------------------------------------
console.log("\n[Case 2] Genuinely high-risk segment: Month-to-month at 25.0% churn vs 13.5% overall");

const highRiskBreakdown: Breakdown = {
  dimension: "Contract",
  rows: [
    { label: "Month-to-month", total: 665, churned: 166, rate: 25.0, average: 80.0, reliable: true },
    { label: "One year", total: 284, churned: 27, rate: 9.5, average: 65.0, reliable: true },
    { label: "Two year", total: 261, churned: 28, rate: 10.7, average: 60.0, reliable: true },
  ],
};

const recommendationsCase2 = buildRecommendations(
  true,
  highRiskBreakdown,
  highRiskBreakdown.rows,
  overallRate,
  noCorrelations,
);

assert(recommendationsCase2.length === 1, "Expected 1 recommendation");
const rec2 = recommendationsCase2[0];
assert(rec2.problem.includes("Contract Month-to-month is the highest-churn validated group"), `Should identify Month-to-month as highest-churn group (got: "${rec2.problem}")`);
assert(rec2.evidence.includes("25% churn across 665 customers"), `Should cite 25% churn across 665 customers (got: "${rec2.evidence}")`);
assert(rec2.segment === "Contract Month-to-month", `Target segment should be Contract Month-to-month (got: "${rec2.segment}")`);

// -----------------------------------------------------------------------------
// Test Case 3: Mixed segment sizes (one sparse group with 2 customers, three large groups)
// - Must evaluate each segment individually!
// - Sparse group must be excluded, but large groups must NOT be discarded!
// -----------------------------------------------------------------------------
console.log("\n[Case 3] Mixed segment sizes: 3 large groups (665, 284, 261) and 1 sparse group (2 customers)");

const mixedBreakdown: Breakdown = {
  dimension: "Contract",
  rows: [
    { label: "Month-to-month", total: 665, churned: 108, rate: 16.2, average: 75.5, reliable: true },
    { label: "One year", total: 284, churned: 27, rate: 9.5, average: 65.0, reliable: true },
    { label: "Two year", total: 261, churned: 28, rate: 10.7, average: 60.0, reliable: true },
    { label: "Custom plan", total: 2, churned: 2, rate: 100.0, average: 90.0, reliable: false },
  ],
};

const { segments: builtSegments, segmentRows: evaluatedSegmentRows } = buildSegments(
  ["Contract"],
  [],
  [],
  overallRate,
  [mixedBreakdown],
  new Map(),
  [],
);

assert(evaluatedSegmentRows.length === 3, `Evaluated segments must be 3, sparse group excluded (got: ${evaluatedSegmentRows.length})`);
assert(!evaluatedSegmentRows.some((r) => r.label === "Custom plan"), "Custom plan (n=2) must be excluded");
assert(evaluatedSegmentRows.some((r) => r.label === "Month-to-month"), "Month-to-month (n=665) must be included");
assert(evaluatedSegmentRows.some((r) => r.label === "One year"), "One year (n=284) must be included");
assert(evaluatedSegmentRows.some((r) => r.label === "Two year"), "Two year (n=261) must be included");

// Verify segment risk values in builtSegments
assert(builtSegments.length === 3, `Built segments count should be 3 (got: ${builtSegments.length})`);
for (const s of builtSegments) {
  assert(s.risk !== "High risk", `Segment ${s.name} must NOT be called High risk (got: ${s.risk})`);
}

// -----------------------------------------------------------------------------
// Test Case 4: Truly sparse dataset (all candidate groups have < 5 customers)
// - Must cleanly produce the insufficient sample size message
// -----------------------------------------------------------------------------
console.log("\n[Case 4] Truly sparse dataset: all groups have fewer than 5 customers");

const sparseBreakdown: Breakdown = {
  dimension: "PilotProgram",
  rows: [
    { label: "Cohort A", total: 3, churned: 1, rate: 33.3, average: 50.0, reliable: false },
    { label: "Cohort B", total: 2, churned: 0, rate: 0.0, average: 40.0, reliable: false },
  ],
};

const recommendationsCase4 = buildRecommendations(
  true,
  sparseBreakdown,
  sparseBreakdown.rows,
  overallRate,
  noCorrelations,
);

assert(recommendationsCase4.length === 1, "Expected 1 recommendation for sparse dataset");
const rec4 = recommendationsCase4[0];
assert(rec4.problem.includes("No category segment met the minimum sample size"), `Should state minimum sample size not met (got: "${rec4.problem}")`);
assert(rec4.evidence.includes("All normalized category groups have fewer than 5 customers"), `Evidence should state all groups have fewer than 5 customers (got: "${rec4.evidence}")`);

// -----------------------------------------------------------------------------
// Test Case 5: End-to-end analyzeDataset() with realistic 1,210-row dataset
// matching the user's scenario (Month-to-month 665/16.2%, One year 284/9.5%, Two year 261/10.7%)
// -----------------------------------------------------------------------------
console.log("\n[Case 5] End-to-end analyzeDataset() on full dataset matching user's counts & rates");

const rows: (string | number | boolean | null)[][] = [];
// Month-to-month: 665 rows, 108 churned (16.24%)
for (let i = 0; i < 665; i++) {
  const isChurn = i < 108;
  rows.push([`CUST-M-${i}`, "Month-to-month", 10 + (i % 50), 75 + (i % 20), isChurn ? "Yes" : "No"]);
}
// One year: 284 rows, 27 churned (9.51%)
for (let i = 0; i < 284; i++) {
  const isChurn = i < 27;
  rows.push([`CUST-O-${i}`, "One year", 20 + (i % 50), 65 + (i % 20), isChurn ? "Yes" : "No"]);
}
// Two year: 261 rows, 28 churned (10.73%)
for (let i = 0; i < 261; i++) {
  const isChurn = i < 28;
  rows.push([`CUST-T-${i}`, "Two year", 30 + (i % 40), 60 + (i % 20), isChurn ? "Yes" : "No"]);
}

const analysis = await analyzeDataset({
  rows,
  fileName: "contract_churn_case.csv",
  columns: ["CustomerID", "Contract", "tenure", "MonthlyCharges", "Churn"],
});

console.log(`- Dataset rows: ${analysis.overview.rows}`);
console.log(`- Overall churn rate: ${analysis.overview.churnRate}% (${analysis.overview.churned}/${analysis.overview.rows})`);
console.log(`- Segments evaluated: ${analysis.segments.length}`);
for (const seg of analysis.segments) {
  console.log(`  * ${seg.name}: ${seg.customers} customers, ${seg.churnRate}% churn, Risk: ${seg.risk}`);
}
console.log(`- Business recommendations: ${analysis.recommendations.length}`);
for (const r of analysis.recommendations) {
  console.log(`  * [${r.segment}] ${r.problem}`);
  console.log(`    Evidence: ${r.evidence}`);
}

assert(analysis.overview.rows === 1210, `Total rows must be 1210 (got: ${analysis.overview.rows})`);
assert(Math.round(analysis.overview.churnRate * 10) / 10 === 13.5, `Overall churn rate should be ~13.5% (got: ${analysis.overview.churnRate}%)`);
assert(analysis.segments.length === 3, `Expected 3 evaluated Contract segments (got: ${analysis.segments.length})`);

// Verify all 3 segments are present and none is marked High risk
for (const s of analysis.segments) {
  assert(s.risk !== "High risk", `Segment ${s.name} (${s.churnRate}%) must not be High risk (got: ${s.risk})`);
}

// Verify the recommendation does NOT state "All normalized category groups have fewer than 5 customers"
const contractRec = analysis.recommendations.find((r) => r.segment.includes("Contract"));
assert(Boolean(contractRec), "Should have a Contract recommendation");
assert(!contractRec!.evidence.includes("All normalized category groups have fewer than 5 customers"), "Must not claim all groups are sparse");
assert(contractRec!.problem.includes("No evaluated Contract segment exceeds the risk threshold"), "Must correctly state no evaluated segment exceeds risk threshold");

console.log("\n=========================================================");
console.log("ALL 5 RECOMMENDATION & SEGMENTATION TESTS PASSED 100%!");
console.log("=========================================================");
