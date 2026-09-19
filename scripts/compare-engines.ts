import app from "../artifacts/api-server/src/app";
import { analyzeDataset } from "../artifacts/churn-analytics/src/analytics/analyzeDataset";
import type { AnalyzeRequest, AnalyzeResponse } from "../artifacts/churn-analytics/src/analytics/types";
import http from "node:http";

function generateSyntheticChurnDataset(count = 1000): AnalyzeRequest {
  const columns = [
    "CustomerID",
    "gender",
    "Age",
    "tenure",
    "Contract",
    "PaymentMethod",
    "InternetService",
    "MonthlyCharges",
    "TotalCharges",
    "Churn",
  ];

  const contracts = ["Month-to-month", "One year", "Two year"];
  const payments = ["Electronic check", "Mailed check", "Bank transfer", "Credit card"];
  const internets = ["Fiber optic", "DSL", "No"];
  const genders = ["Male", "Female", "female", "FEMALE"]; // intentional casing variants

  const rows: (string | number | boolean | null)[][] = [];

  for (let i = 1; i <= count; i++) {
    const isChurn = i % 4 === 0; // ~25% churn
    const contract = isChurn ? contracts[0] : contracts[i % contracts.length];
    const tenure = isChurn ? Math.max(1, (i % 24) + 1) : Math.min(72, (i % 72) + 1);
    const monthly = isChurn ? 70 + (i % 40) : 20 + (i % 60);
    const total = monthly * tenure;
    const gender = genders[i % genders.length];
    const age = 20 + (i % 60);

    // Intentional outliers and missing values
    const monthlyVal = i === 13 ? 9999 : monthly;
    const totalVal = i === 27 ? null : total;

    rows.push([
      `CUST-${String(i).padStart(5, "0")}`,
      gender,
      age,
      tenure,
      contract,
      payments[i % payments.length],
      internets[i % internets.length],
      monthlyVal,
      totalVal,
      isChurn ? "Yes" : "No",
    ]);
  }

  // Add 2 duplicate rows to verify duplicate detection
  if (rows.length >= 2) {
    rows.push([...rows[0]]);
    rows.push([...rows[1]]);
  }

  return {
    fileName: "synthetic_telecom_churn.csv",
    columns,
    rows,
  };
}

async function startServer(port: number): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve(server));
  });
}

function deepCompare(a: unknown, b: unknown, path = ""): string[] {
  const diffs: string[] = [];
  if (typeof a !== typeof b) {
    diffs.push(`${path}: type mismatch (${typeof a} vs ${typeof b})`);
    return diffs;
  }
  if (a === null || b === null || typeof a !== "object") {
    if (typeof a === "number" && typeof b === "number") {
      // Numerical comparison with small epsilon for floating points
      if (Math.abs(a - b) > 1e-4) {
        diffs.push(`${path}: numerical difference (${a} vs ${b})`);
      }
    } else if (a !== b) {
      diffs.push(`${path}: value mismatch (${JSON.stringify(a)} vs ${JSON.stringify(b)})`);
    }
    return diffs;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push(`${path}: array length mismatch (${a.length} vs ${b.length})`);
    }
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      diffs.push(...deepCompare(a[i], b[i], `${path}[${i}]`));
    }
    return diffs;
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(objA), ...Object.keys(objB)]);

  for (const key of keys) {
    if (!(key in objA)) {
      diffs.push(`${path}.${key}: missing in first object`);
    } else if (!(key in objB)) {
      diffs.push(`${path}.${key}: missing in second object`);
    } else {
      diffs.push(...deepCompare(objA[key], objB[key], `${path}.${key}`));
    }
  }

  return diffs;
}

async function runComparison() {
  console.log("=================================================================");
  console.log("CUSTOMER CHURN ANALYTICS: BACKEND VS CLIENT-SIDE ENGINE BENCHMARK");
  console.log("=================================================================");

  const testPort = 5999;
  const server = await startServer(testPort);
  console.log(`Ephemeral Express backend running on port ${testPort}`);

  try {
    const dataset = generateSyntheticChurnDataset(1000);
    console.log(`Generated synthetic dataset with ${dataset.rows.length} rows and ${dataset.columns.length} columns.`);

    // 1. Run via Express Backend
    const startBackend = performance.now();
    const backendRes = await fetch(`http://localhost:${testPort}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dataset),
    });
    const backendTime = performance.now() - startBackend;
    if (!backendRes.ok) {
      throw new Error(`Backend error: ${backendRes.status} ${await backendRes.text()}`);
    }
    const backendData = (await backendRes.json()) as AnalyzeResponse;
    console.log(`Backend execution completed in ${backendTime.toFixed(1)}ms`);

    // 2. Run via Client-Side Engine
    const startClient = performance.now();
    const clientData = await analyzeDataset(dataset);
    const clientTime = performance.now() - startClient;
    console.log(`Client-side execution completed in ${clientTime.toFixed(1)}ms`);

    // 3. Compare Results
    console.log("\n--- RESULT COMPARISON ---");
    console.log(`1. Dataset Overview:`);
    console.log(`   - Backend churn rate: ${backendData.overview.churnRate}% (${backendData.overview.churned}/${backendData.overview.rows})`);
    console.log(`   - Client  churn rate: ${clientData.overview.churnRate}% (${clientData.overview.churned}/${clientData.overview.rows})`);
    console.log(`   - Avg Tenure: ${backendData.overview.avgTenure} vs ${clientData.overview.avgTenure}`);
    console.log(`   - Avg Monthly Charges: ${backendData.overview.avgMonthlyCharges} vs ${clientData.overview.avgMonthlyCharges}`);

    console.log(`\n2. Data Quality Metrics:`);
    console.log(`   - Missing cells: Backend=${backendData.quality.missingCells}, Client=${clientData.quality.missingCells}`);
    console.log(`   - Duplicates: Backend=${backendData.quality.duplicateRows}, Client=${clientData.quality.duplicateRows}`);
    console.log(`   - Outliers: Backend=${backendData.quality.outlierCells}, Client=${clientData.quality.outlierCells}`);
    console.log(`   - Inconsistent categories: Backend=${backendData.quality.inconsistentCategories}, Client=${clientData.quality.inconsistentCategories}`);

    console.log(`\n3. Statistical Tests:`);
    console.log(`   - Number of statistical tests: Backend=${backendData.statisticalAnalysis.tests.length}, Client=${clientData.statisticalAnalysis.tests.length}`);
    for (let i = 0; i < Math.min(3, backendData.statisticalAnalysis.tests.length); i++) {
      const bTest = backendData.statisticalAnalysis.tests[i];
      const cTest = clientData.statisticalAnalysis.tests[i];
      console.log(`   * ${bTest.feature} (${bTest.test}): stat=${bTest.statistic} vs ${cTest.statistic}, p=${bTest.pValue} vs ${cTest.pValue}, adjP=${bTest.adjustedPValue} vs ${cTest.adjustedPValue}, effect=${bTest.effectSize} (${bTest.effectSizeLabel})`);
    }

    console.log(`\n4. Machine Learning Benchmarks:`);
    console.log(`   - Best model: Backend=${backendData.predictiveModeling.bestModel}, Client=${clientData.predictiveModeling.bestModel}`);
    console.log(`   - Recommended model: Backend=${backendData.predictiveModeling.recommendedModel} at threshold ${backendData.predictiveModeling.recommendedThreshold}`);
    console.log(`   - Client recommended: Client=${clientData.predictiveModeling.recommendedModel} at threshold ${clientData.predictiveModeling.recommendedThreshold}`);
    for (let i = 0; i < backendData.predictiveModeling.models.length; i++) {
      const bm = backendData.predictiveModeling.models[i];
      const cm = clientData.predictiveModeling.models[i];
      console.log(`   * ${bm.model}: ROC-AUC=${bm.rocAuc} (Client=${cm.rocAuc}), Acc=${bm.accuracy} (Client=${cm.accuracy}), F1=${bm.f1} (Client=${cm.f1})`);
    }

    console.log(`\n5. Segments:`);
    console.log(`   - Number of segments: Backend=${backendData.segments.length}, Client=${clientData.segments.length}`);
    backendData.segments.forEach((seg, idx) => {
      const cSeg = clientData.segments[idx];
      console.log(`   * ${seg.name}: customers=${seg.customers}, churn=${seg.churnRate}%, risk=${seg.risk} (Client: ${cSeg.name}, churn=${cSeg.churnRate}%, risk=${cSeg.risk})`);
    });

    console.log(`\n6. Recommendations:`);
    console.log(`   - Number of recommendations: Backend=${backendData.recommendations.length}, Client=${clientData.recommendations.length}`);
    backendData.recommendations.forEach((rec, idx) => {
      const cRec = clientData.recommendations[idx];
      console.log(`   * Rec ${idx + 1}: ${rec.problem.substring(0, 50)}...`);
      console.log(`     Match: ${rec.problem === cRec.problem && rec.action === cRec.action ? "PERFECT MATCH" : "DIFFERENCE DETECTED"}`);
    });

    // Run deep recursive comparison
    const diffs = deepCompare(backendData, clientData);
    console.log(`\n7. Deep Equality Check:`);
    if (diffs.length === 0) {
      console.log("   >>> SUCCESS: 0 differences found! The client-side engine produces 100% equivalent results to the backend! <<<");
    } else {
      console.log(`   Found ${diffs.length} differences:`);
      diffs.slice(0, 10).forEach((d) => console.log(`   - ${d}`));
    }

    // 4. Benchmark realistic dataset sizes
    console.log("\n--- REALISTIC DATASET SIZE BENCHMARKS ---");
    const sizes = [100, 500, 1000, 2500, 5000, 10000];
    for (const size of sizes) {
      const ds = generateSyntheticChurnDataset(size);
      const t0 = performance.now();
      await analyzeDataset(ds);
      const elapsed = performance.now() - t0;
      console.log(`Dataset size: ${size.toLocaleString()} rows -> Processed in ${elapsed.toFixed(1)} ms`);
    }


    console.log("\n=================================================================");
    console.log("PHASE 2 VALIDATION COMPLETE");
    console.log("=================================================================");
  } finally {
    server.close();
  }
}

runComparison().catch((err) => {
  console.error("Comparison test failed:", err);
  process.exit(1);
});
