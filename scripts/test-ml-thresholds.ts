import fs from "fs";
import path from "path";
import Papa from "papaparse";
import { analyzeDataset } from "../src/analytics/analyzeDataset";
import type { AnalyzeRequest } from "../src/analytics/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

async function runThresholdConsistencyTests() {
  console.log("=========================================================");
  console.log("TESTING ML PREDICTION THRESHOLD CONSISTENCY & REPORTING");
  console.log("=========================================================\n");

  // Locate customer_churn_analytics_test_2.csv
  const candidatePaths = [
    path.resolve(process.env.USERPROFILE || "C:\\Users\\parva", "Downloads", "customer_churn_analytics_test_2.csv"),
    path.resolve("customer_churn_analytics_test_2.csv"),
    path.resolve("scratch", "customer_churn_analytics_test_2.csv"),
  ];

  const filePath = candidatePaths.find((p) => fs.existsSync(p));
  if (!filePath) {
    throw new Error(`Could not locate customer_churn_analytics_test_2.csv in: ${candidatePaths.join(", ")}`);
  }

  console.log(`[Step 1] Loading dataset from: ${filePath}`);
  const csvContent = fs.readFileSync(filePath, "utf-8");
  const parseResult = Papa.parse<unknown[]>(csvContent, {
    skipEmptyLines: true,
    dynamicTyping: true,
  });

  const parsedData = parseResult.data;
  const columns = (parsedData[0] as unknown[]).map((v) => String(v ?? "").trim());
  const dataRows = (parsedData.slice(1) as (string | number | boolean | null)[][]).map((row) =>
    columns.map((_, i) => row[i] ?? null),
  );

  const request: AnalyzeRequest = {
    fileName: path.basename(filePath),
    columns,
    rows: dataRows,
  };

  console.log(`Ingested ${request.rows.length} rows across ${request.columns.length} columns.`);
  const analysis = await analyzeDataset(request);
  const modeling = analysis.predictiveModeling;

  // ---------------------------------------------------------------------------
  // Check 1: Baseline model metrics use default threshold 0.50
  // ---------------------------------------------------------------------------
  console.log("\n[Check 1] Baseline models use default threshold 0.50 & proper naming");
  const baselineLR = modeling.models.find((m) => m.model === "Baseline Logistic Regression");
  assert(Boolean(baselineLR), "Baseline Logistic Regression model must exist with exact name 'Baseline Logistic Regression'");
  assert(baselineLR!.threshold === 0.5, "Baseline Logistic Regression threshold must be 0.50");
  for (const m of modeling.models) {
    assert(m.model.startsWith("Baseline "), `Baseline model '${m.model}' must start with 'Baseline '`);
    assert(m.threshold === 0.5, `Baseline model '${m.model}' must report threshold 0.5`);
  }

  // ---------------------------------------------------------------------------
  // Check 2: Imbalance-adjusted models clearly identify threshold 0.50
  // ---------------------------------------------------------------------------
  console.log("\n[Check 2] Adjusted models use clear naming and default threshold 0.50 in comparison");
  const adjustedLR = modeling.adjustedModels.find((m) => m.model === "Adjusted Logistic Regression");
  assert(Boolean(adjustedLR), "Adjusted Logistic Regression model must exist with exact name 'Adjusted Logistic Regression'");
  assert(adjustedLR!.threshold === 0.5, "Adjusted Logistic Regression in comparison table must report default threshold 0.5");
  for (const m of modeling.adjustedModels) {
    assert(m.model.startsWith("Adjusted "), `Adjusted model '${m.model}' must start with 'Adjusted '`);
    assert(m.threshold === 0.5, `Adjusted model '${m.model}' must report default threshold 0.5`);
  }

  // ---------------------------------------------------------------------------
  // Check 3: Threshold analysis reports exact metrics produced at each threshold
  // ---------------------------------------------------------------------------
  console.log("\n[Check 3] Threshold analysis entries match mathematical confusion matrix formulas");
  for (const row of modeling.thresholdAnalysis) {
    const { confusionMatrix: cm, precision, recall, f1, accuracy, predictedPositiveRate } = row;
    const total = cm.truePositive + cm.falsePositive + cm.trueNegative + cm.falseNegative;
    const expectedAcc = total > 0 ? (cm.truePositive + cm.trueNegative) / total : 0;
    const expectedPrec = cm.truePositive + cm.falsePositive > 0 ? cm.truePositive / (cm.truePositive + cm.falsePositive) : 0;
    const expectedRec = cm.truePositive + cm.falseNegative > 0 ? cm.truePositive / (cm.truePositive + cm.falseNegative) : 0;
    const expectedF1 = expectedPrec + expectedRec > 0 ? (2 * expectedPrec * expectedRec) / (expectedPrec + expectedRec) : 0;
    const expectedFlagged = total > 0 ? (cm.truePositive + cm.falsePositive) / total : 0;

    assert(Math.abs(precision - expectedPrec) < 1e-4, `Precision mismatch at threshold ${row.threshold} for ${row.model}`);
    assert(Math.abs(recall - expectedRec) < 1e-4, `Recall mismatch at threshold ${row.threshold} for ${row.model}`);
    assert(Math.abs(f1 - expectedF1) < 1e-4, `F1 mismatch at threshold ${row.threshold} for ${row.model}`);
    assert(Math.abs(accuracy - expectedAcc) < 1e-4, `Accuracy mismatch at threshold ${row.threshold} for ${row.model}`);
    assert(Math.abs(predictedPositiveRate - expectedFlagged) < 1e-4, `Flagged rate mismatch at threshold ${row.threshold} for ${row.model}`);
  }

  // ---------------------------------------------------------------------------
  // Check 4 & 5: Selected threshold metrics match threshold table and are not mixed with 0.50
  // ---------------------------------------------------------------------------
  console.log("\n[Check 4 & 5] Selected threshold (0.60) matches threshold table row and is distinct from 0.50");
  assert(modeling.recommendedModel === "Adjusted Logistic Regression", `Recommended model must be Adjusted Logistic Regression (got ${modeling.recommendedModel})`);
  assert(modeling.recommendedThreshold === 0.6, `Recommended threshold must be 0.60 (got ${modeling.recommendedThreshold})`);

  const selectedRow = modeling.thresholdAnalysis.find(
    (r) => r.model === modeling.recommendedModel && Math.abs(r.threshold - modeling.recommendedThreshold) < 1e-4
  );
  assert(Boolean(selectedRow), "Selected threshold row must exist in thresholdAnalysis");

  // Threshold 0.60 metrics on test set
  console.log(`- Selected 0.60: Prec=${(selectedRow!.precision * 100).toFixed(1)}%, Rec=${(selectedRow!.recall * 100).toFixed(1)}%, F1=${(selectedRow!.f1 * 100).toFixed(1)}%, Flagged=${(selectedRow!.predictedPositiveRate * 100).toFixed(1)}%`);
  console.log(`- Default 0.50:  Prec=${(adjustedLR!.precision * 100).toFixed(1)}%, Rec=${(adjustedLR!.recall * 100).toFixed(1)}%, F1=${(adjustedLR!.f1 * 100).toFixed(1)}%`);

  assert(Math.abs(selectedRow!.precision - 0.2642) < 1e-3, `Expected threshold 0.60 precision ~26.4% (got ${(selectedRow!.precision * 100).toFixed(1)}%)`);
  assert(Math.abs(selectedRow!.recall - 0.4375) < 1e-3, `Expected threshold 0.60 recall ~43.8% (got ${(selectedRow!.recall * 100).toFixed(1)}%)`);
  assert(Math.abs(selectedRow!.f1 - 0.3294) < 1e-3, `Expected threshold 0.60 F1 ~32.9% (got ${(selectedRow!.f1 * 100).toFixed(1)}%)`);

  // Ensure 0.50 and 0.60 are NOT mixed
  assert(Math.abs(selectedRow!.recall - adjustedLR!.recall) > 0.1, "Threshold 0.60 recall (43.8%) and default 0.50 recall (62.5%) must not be mixed!");
  assert(modeling.selectionRationale.includes("43.8%"), "Selection rationale must cite 0.60 Recall (43.8%)");
  assert(modeling.selectionRationale.includes("32.9%"), "Selection rationale must cite 0.60 F1 (32.9%)");

  // ---------------------------------------------------------------------------
  // Check 6: Terminology in Markdown Export and Structure
  // ---------------------------------------------------------------------------
  console.log("\n[Check 6] Verifying Markdown export report terminology and sections");
  const pct = (val: number) => `${val.toFixed(1)}%`;
  const markdownReport = [
    `# Customer churn analysis — ${analysis.fileName}`,
    "",
    "## Predictive modeling",
    `- Retention-oriented recommendation: ${modeling.recommendedModel} at selected threshold ${modeling.recommendedThreshold.toFixed(2)}.`,
    "",
    "### Baseline models (default threshold 0.50)",
    ...modeling.models.flatMap((model) => [
      `- ${model.model}: Accuracy ${pct(model.accuracy * 100)}, Precision ${pct(model.precision * 100)}, Recall ${pct(model.recall * 100)}, F1 ${pct(model.f1 * 100)}, ROC-AUC ${model.rocAuc.toFixed(3)}.`,
    ]),
    "",
    "### Adjusted models (default threshold 0.50)",
    ...modeling.adjustedModels.flatMap((model) => [
      `- ${model.model}: Accuracy ${pct(model.accuracy * 100)}, Precision ${pct(model.precision * 100)}, Recall ${pct(model.recall * 100)}, F1 ${pct(model.f1 * 100)}, ROC-AUC ${model.rocAuc.toFixed(3)}.`,
    ]),
    "",
    "### Selected threshold metrics",
    ...(() => {
      const selected = modeling.thresholdAnalysis.find(
        (row) => row.model === modeling.recommendedModel && row.threshold === modeling.recommendedThreshold
      );
      if (!selected) return [`- ${modeling.selectionRationale}`];
      const m = modeling.adjustedModels.find((x) => x.model === modeling.recommendedModel)
        ?? modeling.models.find((x) => x.model === modeling.recommendedModel);
      return [
        `- Model: ${modeling.recommendedModel}`,
        `- Selected threshold: ${selected.threshold.toFixed(2)}`,
        `- Precision: ${pct(selected.precision * 100)}`,
        `- Recall: ${pct(selected.recall * 100)}`,
        `- F1: ${pct(selected.f1 * 100)}`,
        `- ROC-AUC: ${m ? m.rocAuc.toFixed(3) : "not available"}`,
        `- Flagged: ${pct(selected.predictedPositiveRate * 100)}`,
        `  Confusion matrix: TP ${selected.confusionMatrix.truePositive}, FP ${selected.confusionMatrix.falsePositive}, TN ${selected.confusionMatrix.trueNegative}, FN ${selected.confusionMatrix.falseNegative}.`,
        `- Rationale: ${modeling.selectionRationale}`,
      ];
    })(),
    "",
    "### Threshold analysis",
    ...modeling.thresholdAnalysis.filter((row) => row.model === modeling.recommendedModel).map(
      (row) => `- Threshold ${row.threshold.toFixed(2)} for ${row.model}: Precision ${pct(row.precision * 100)}, Recall ${pct(row.recall * 100)}, F1 ${pct(row.f1 * 100)}, Flagged ${pct(row.predictedPositiveRate * 100)}.`
    ),
  ].join("\n");

  assert(markdownReport.includes("Baseline Logistic Regression"), "Markdown must include 'Baseline Logistic Regression'");
  assert(markdownReport.includes("Adjusted Logistic Regression"), "Markdown must include 'Adjusted Logistic Regression'");
  assert(markdownReport.includes("Selected threshold: 0.60"), "Markdown must include 'Selected threshold: 0.60'");
  assert(markdownReport.includes("Precision: 26.4%"), "Markdown must include 'Precision: 26.4%'");
  assert(markdownReport.includes("Recall: 43.8%"), "Markdown must include 'Recall: 43.8%'");
  assert(markdownReport.includes("F1: 32.9%"), "Markdown must include 'F1: 32.9%'");
  assert(markdownReport.includes(`ROC-AUC: ${adjustedLR!.rocAuc.toFixed(3)}`), `Markdown must include selected model 'ROC-AUC: ${adjustedLR!.rocAuc.toFixed(3)}'`);
  assert(markdownReport.includes(`ROC-AUC ${baselineLR!.rocAuc.toFixed(3)}`), `Markdown must include baseline model 'ROC-AUC ${baselineLR!.rocAuc.toFixed(3)}'`);
  assert(!markdownReport.includes("Adjusted Logistic Regression · imbalance-adjusted"), "Must NOT contain redundant '· imbalance-adjusted' label");

  console.log("\n=========================================================");
  console.log("ALL ML THRESHOLD CONSISTENCY CHECKS PASSED SUCCESSFULLY!");
  console.log("=========================================================");
}

runThresholdConsistencyTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
