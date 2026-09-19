import Papa from "papaparse";
import { analyzeDataset } from "../src/analytics/analyzeDataset";
import type { AnalyzeRequest } from "../src/analytics/types";

function buildSyntheticCSV(rowCount = 500): string {
  const contracts = ["Month-to-month", "One year", "Two year"];
  const payments = ["Electronic check", "Mailed check", "Bank transfer", "Credit card"];
  const internets = ["Fiber optic", "DSL", "No"];
  const genders = ["Male", "Female", "female", "FEMALE"];

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= rowCount; i++) {
    const isChurn = i % 4 === 0;
    const contract = isChurn ? contracts[0] : contracts[i % contracts.length];
    const tenure = isChurn ? Math.max(1, (i % 24) + 1) : Math.min(72, (i % 72) + 1);
    const monthly = isChurn ? 70 + (i % 40) : 20 + (i % 60);
    const total = monthly * tenure;

    rows.push({
      CustomerID: `CUST-${String(i).padStart(5, "0")}`,
      gender: genders[i % genders.length],
      Age: 20 + (i % 60),
      tenure,
      Contract: contract,
      PaymentMethod: payments[i % payments.length],
      InternetService: internets[i % internets.length],
      MonthlyCharges: i === 13 ? 9999 : monthly, // outlier
      TotalCharges: i === 27 ? "" : total,      // missing value
      Churn: isChurn ? "Yes" : "No",
    });
  }

  // Add duplicate
  if (rows.length > 0) {
    rows.push({ ...rows[0] });
  }

  return Papa.unparse(rows);
}

async function runWorkflowTest() {
  console.log("=========================================================");
  console.log("TESTING COMPLETE END-TO-END DASHBOARD WORKFLOW (CLIENT ENGINE)");
  console.log("=========================================================");

  // Step 1: Simulate CSV Upload & Browser PapaParse (matching App.tsx lines 92-100)
  console.log("\n[Step 1] Ingesting CSV file with PapaParse...");
  const rawCSV = buildSyntheticCSV(500);
  const parseResult = Papa.parse<unknown[]>(rawCSV, {
    skipEmptyLines: true,
    dynamicTyping: true,
  });

  if (parseResult.errors.length > 0) {
    throw new Error(`CSV parsing error: ${JSON.stringify(parseResult.errors)}`);
  }

  const parsedData = parseResult.data;
  if (!parsedData.length || parsedData.length < 2) {
    throw new Error("File does not contain header and data rows.");
  }

  const columns = (parsedData[0] as unknown[]).map((v) => String(v ?? "").trim());
  const dataRows = (parsedData.slice(1) as (string | number | boolean | null)[][]).map((row) =>
    columns.map((_, i) => row[i] ?? null),
  );

  const request: AnalyzeRequest = {
    fileName: "synthetic_churn_test.csv",
    columns,
    rows: dataRows,
  };
  console.log(`Parsed ${request.rows.length} rows across ${request.columns.length} columns: [${request.columns.join(", ")}]`);

  // Step 2: Execute Client-Side Analysis Pipeline
  console.log("\n[Step 2] Executing analyzeDataset()...");
  const t0 = performance.now();
  const analysis = await analyzeDataset(request);
  const elapsed = performance.now() - t0;
  console.log(`Analysis pipeline executed successfully in ${elapsed.toFixed(1)}ms!`);

  // Step 3: Validate Overview Metrics
  console.log("\n[Step 3] Validating Overview Metrics:");
  console.log(`- Rows: ${analysis.overview.rows}`);
  console.log(`- Columns: ${analysis.overview.columns}`);
  console.log(`- Churned: ${analysis.overview.churned}`);
  console.log(`- Retained: ${analysis.overview.retained}`);
  console.log(`- Churn Rate: ${analysis.overview.churnRate}%`);
  console.log(`- Avg Tenure: ${analysis.overview.avgTenure} months`);
  console.log(`- Avg Monthly Charges: $${analysis.overview.avgMonthlyCharges}`);
  if (analysis.overview.churnRate <= 0 || analysis.overview.rows !== 501) {
    throw new Error("Overview metrics validation failed.");
  }

  // Step 4: Validate Data Quality
  console.log("\n[Step 4] Validating Data Quality Checks:");
  console.log(`- Missing cells: ${analysis.quality.missingCells}`);
  console.log(`- Duplicate rows: ${analysis.quality.duplicateRows}`);
  console.log(`- Outlier cells: ${analysis.quality.outlierCells}`);
  console.log(`- Inconsistent category labels: ${analysis.quality.inconsistentCategories}`);
  console.log(`- Quality issues found: ${analysis.quality.issues.length}`);
  console.log(`- Quality warnings: ${analysis.quality.warnings.length}`);
  if (analysis.quality.duplicateRows !== 1 || analysis.quality.missingCells < 1) {
    throw new Error("Data quality validation failed.");
  }

  // Step 5: Validate Target Detection
  console.log("\n[Step 5] Validating Target Detection:");
  console.log(`- Detected: ${analysis.target.detected}`);
  console.log(`- Target column: "${analysis.target.column}"`);
  console.log(`- Positive label: "${analysis.target.positiveLabel}"`);
  console.log(`- Negative label: "${analysis.target.negativeLabel}"`);
  if (!analysis.target.detected || analysis.target.column !== "Churn") {
    throw new Error("Target detection failed.");
  }

  // Step 6: Validate Statistical Testing
  console.log("\n[Step 6] Validating Statistical Tests:");
  console.log(`- Total statistical tests run: ${analysis.statisticalAnalysis.tests.length}`);
  for (const test of analysis.statisticalAnalysis.tests.slice(0, 3)) {
    console.log(`  * ${test.feature} (${test.test}): stat=${test.statistic}, p=${test.pValue}, adjP=${test.adjustedPValue}, effect=${test.effectSize} (${test.effectSizeLabel}), significant=${test.significant}`);
  }
  if (analysis.statisticalAnalysis.tests.length === 0) {
    throw new Error("Statistical testing failed.");
  }

  // Step 7: Validate Predictive Modeling
  console.log("\n[Step 7] Validating Predictive Modeling Benchmarks:");
  console.log(`- Best held-out model: ${analysis.predictiveModeling.bestModel}`);
  console.log(`- Recommended model: ${analysis.predictiveModeling.recommendedModel} at threshold ${analysis.predictiveModeling.recommendedThreshold}`);
  console.log(`- Baseline models: ${analysis.predictiveModeling.models.length}`);
  console.log(`- Adjusted models: ${analysis.predictiveModeling.adjustedModels.length}`);
  for (const m of analysis.predictiveModeling.models) {
    console.log(`  * ${m.model}: ROC-AUC=${m.rocAuc}, Acc=${m.accuracy}, Recall=${m.recall}, F1=${m.f1}`);
  }
  if (analysis.predictiveModeling.models.length !== 3) {
    throw new Error("Predictive modeling benchmark failed.");
  }

  // Step 8: Validate Customer Segmentation & Recommendations
  console.log("\n[Step 8] Validating Segmentation & Recommendations:");
  console.log(`- Validated segments (N >= 5): ${analysis.segments.length}`);
  for (const s of analysis.segments) {
    console.log(`  * ${s.name}: ${s.customers} customers, ${s.churnRate}% churn, Risk: ${s.risk}`);
  }
  console.log(`- Business recommendations: ${analysis.recommendations.length}`);
  for (const r of analysis.recommendations) {
    console.log(`  * [${r.segment}] ${r.problem} -> Action: ${r.action}`);
  }
  if (analysis.segments.length === 0 || analysis.recommendations.length === 0) {
    throw new Error("Segmentation or recommendations failed.");
  }

  // Step 9: Validate Export Report Generation (matching App.tsx exportReport())
  console.log("\n[Step 9] Simulating Markdown Report Export (App.tsx exportReport):");
  const markdownReport = [
    `# Customer churn analysis — ${analysis.fileName}`,
    "",
    "## Executive summary",
    `- ${analysis.overview.rows.toLocaleString()} customers across ${analysis.overview.columns} columns.`,
    `- Churn rate: ${analysis.overview.churnRate}% (${analysis.overview.churned.toLocaleString()} churned; ${analysis.overview.retained.toLocaleString()} retained).`,
    `- Average monthly charges: $${analysis.overview.avgMonthlyCharges}.`,
    "",
    "## Data quality",
    ...analysis.quality.issues.map((issue) => `- ${issue}`),
    "",
    "## Key findings",
    ...analysis.insights.map((insight) => `- ${insight}`),
    "",
    "## Customer segments",
    ...analysis.segments.map((segment) => `- ${segment.name}: ${segment.customers.toLocaleString()} customers, ${segment.churnRate}% churn, ${segment.risk}. ${segment.characteristics}`),
    "",
    "## Business recommendations",
    ...analysis.recommendations.flatMap((recommendation, index) => [
      `### ${index + 1}. ${recommendation.problem}`,
      `- Evidence: ${recommendation.evidence}`,
      `- Action: ${recommendation.action}`,
      `- Objective: ${recommendation.objective}`,
      `- Target segment: ${recommendation.segment}`,
    ]),
    "",
    "## Statistical analysis",
    ...analysis.statisticalAnalysis.tests.flatMap((test) => [
      `- ${test.feature}: ${test.test}; ${test.statisticName} = ${test.statistic.toFixed(3)}; p = ${test.pValue === null ? 'not estimable' : test.pValue}; BH-adjusted p = ${test.adjustedPValue === null ? 'not estimable' : test.adjustedPValue}; effect = ${test.effectSize === null ? 'not estimable' : `${test.effectSize} (${test.effectSizeLabel})`}; ${test.significant ? 'statistically significant' : 'not statistically significant'}.`,
    ]),
    "",
    "## Predictive modeling",
    `- Class distribution: ${analysis.predictiveModeling.classDistribution.positive.toLocaleString()} churned and ${analysis.predictiveModeling.classDistribution.negative.toLocaleString()} retained.`,
    `- Best held-out ROC-AUC model: ${analysis.predictiveModeling.bestModel}.`,
    `- Retention-oriented recommendation: ${analysis.predictiveModeling.recommendedModel} at threshold ${analysis.predictiveModeling.recommendedThreshold.toFixed(2)}.`,
    "",
    "## Method notes",
    ...analysis.methodology.map((method) => `- ${method}`),
    "",
    "## Limitations",
    ...analysis.limitations.map((limitation) => `- ${limitation}`),
    "",
    "_Associations in this report do not establish causation._",
  ].join("\n");

  console.log(`Markdown report generated successfully (${markdownReport.length} characters).`);
  console.log("Preview of report header:\n" + markdownReport.split("\n").slice(0, 10).join("\n"));

  console.log("\n=========================================================");
  console.log("ALL DASHBOARD WORKFLOW CHECKS PASSED WITH 100% SUCCESS!");
  console.log("=========================================================");
}

runWorkflowTest().catch((err) => {
  console.error("Workflow test failed:", err);
  process.exit(1);
});
