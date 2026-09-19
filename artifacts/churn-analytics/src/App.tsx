import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { analyzeDataset, type AnalyzeResponse } from './analytics';
import Papa from 'papaparse';
import { CSVLink } from 'react-csv';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AlertCircle, BarChart3, Check, ChevronDown, CircleHelp, Database, Download,
  Moon, Printer, RefreshCw, ShieldCheck, Sun, Table2, Upload,
} from 'lucide-react';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 300000, refetchOnWindowFocus: false } } });
const COLORS = ['#276d68', '#de7b32', '#6e8b74', '#b64a45', '#7f6a9b'];
const INTERVALS = [{ label: 'Every 5 minutes', ms: 300000 }, { label: 'Every 15 minutes', ms: 900000 }, { label: 'Every hour', ms: 3600000 }, { label: 'Every 24 hours', ms: 86400000 }];
type AnyRecord = Record<string, unknown>;

const num = (v: unknown) => typeof v === 'number' ? v : Number(v) || 0;
const pct = (v: number) => `${v.toFixed(1)}%`;
const compact = (v: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
const money = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

function csvDownload(rows: unknown[], filename: string) {
  const blob = new Blob([Papa.unparse(rows as object[])], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

function textDownload(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

function IconButton({ label, children, onClick, disabled = false }: { label: string; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" aria-label={label} data-testid={`button-${label.toLowerCase().replaceAll(' ', '-')}`} onClick={onClick} disabled={disabled} className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">{children}<span className="hidden sm:inline">{label}</span></button>;
}

function Card({ title, eyebrow, children, exportRows, exportName, className = '' }: { title: string; eyebrow?: string; children: React.ReactNode; exportRows?: unknown[]; exportName?: string; className?: string }) {
  return <section className={`print-break rounded-xl border border-border bg-card p-4 shadow-[0_8px_28px_hsl(205_31%_18%/.035)] ${className}`}>
    <div className="mb-4 flex items-start justify-between gap-3">
      <div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">{eyebrow || 'Analysis'}</p><h2 className="mt-1 text-[15px] font-bold tracking-[-.01em]">{title}</h2></div>
      {exportRows && exportRows.length > 0 && <CSVLink data={exportRows as object[]} filename={exportName || 'chart-data.csv'} aria-label={`Export ${title} as CSV`} data-testid={`button-export-${title.toLowerCase().replaceAll(' ', '-')}`} className="print-hidden inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"><Download size={14} /></CSVLink>}
    </div>{children}
  </section>;
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return <main className="mx-auto flex max-w-5xl flex-1 items-center px-4 py-10 sm:px-8">
    <div className="grid w-full overflow-hidden rounded-2xl border border-border bg-card shadow-[0_18px_60px_hsl(205_31%_18%/.08)] lg:grid-cols-[1.05fr_.95fr]">
      <div className="grid-paper relative flex min-h-[470px] flex-col justify-between overflow-hidden p-7 sm:p-12">
        <div className="relative z-10"><div className="mb-8 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><BarChart3 size={24} /></div><p className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[.2em] text-accent">Decision cockpit / 01</p><h1 className="max-w-md text-4xl font-bold leading-[.98] tracking-[-.06em] sm:text-6xl">Find the signal before it becomes churn.</h1><p className="mt-6 max-w-md text-sm leading-6 text-muted-foreground">Upload a customer CSV and get a defensible read on who is leaving, why they are leaving, and what your team can do next.</p></div>
        <div className="relative z-10 grid max-w-sm grid-cols-3 gap-2 border-t border-border pt-5 text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground"><span>Profile</span><span>Explain</span><span>Act</span></div>
        <div className="absolute -bottom-20 -right-16 h-64 w-64 rounded-full border-[32px] border-accent/15" />
      </div>
      <div className="flex flex-col justify-center p-7 sm:p-12"><p className="text-sm font-bold">Start with your source file</p><p className="mt-2 text-sm leading-6 text-muted-foreground">CSV files are profiled in place. Nothing is changed in your original file.</p><button type="button" onClick={onUpload} data-testid="button-upload-csv" className="mt-8 flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-primary/40 bg-primary/[.045] px-6 text-center transition hover:border-primary hover:bg-primary/[.08]"><span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Upload size={22} /></span><span className="text-sm font-bold">Choose a CSV file</span><span className="mt-1 text-xs text-muted-foreground">UTF-8, comma-separated, up to your workspace limit</span></button><div className="mt-6 flex gap-2 rounded-lg bg-muted/60 p-3 text-xs leading-5 text-muted-foreground"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" />Evidence is labeled clearly so your team can separate observation from recommendation.</div></div>
    </div>
  </main>;
}

function LoadingView() {
  return <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-7 sm:px-8"><div className="mb-7 h-8 w-64 animate-breathe rounded bg-muted" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[1,2,3,4].map(i => <div key={i} className="h-32 animate-breathe rounded-xl border border-border bg-card" />)}</div><div className="mt-4 grid gap-4 lg:grid-cols-2">{[1,2,3,4].map(i => <div key={i} className="h-80 animate-breathe rounded-xl border border-border bg-card" />)}</div></main>;
}

function AppShell() {
  const fileRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | undefined>();
  const [isDark, setIsDark] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [intervalMs, setIntervalMs] = useState(300000);
  const [lastRefreshed, setLastRefreshed] = useState<Date>();
  const [lastRequest, setLastRequest] = useState<{ fileName: string; columns: string[]; rows: (string | number | boolean | null)[][] }>();
  const [uploadError, setUploadError] = useState('');
  const [loading, setLoading] = useState(false);

  const executeAnalysis = async (request: { fileName: string; columns: string[]; rows: (string | number | boolean | null)[][] }) => {
    setLoading(true);
    setUploadError('');
    try {
      const data = await analyzeDataset(request);
      setAnalysis(data);
      setLastRefreshed(new Date());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'We could not analyze that dataset.';
      setUploadError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { document.documentElement.classList.toggle('dark', isDark); }, [isDark]);
  useEffect(() => { const close = (e: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setMenuOpen(false); }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close); }, []);
  useEffect(() => {
    if (!autoRefresh || !analysis || !lastRequest) return;
    const timer = window.setInterval(() => {
      executeAnalysis(lastRequest);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [autoRefresh, analysis, intervalMs, lastRequest]);

  const processFile = (file: File) => {
    setUploadError('');
    Papa.parse<string[]>(file, { skipEmptyLines: true, dynamicTyping: true, complete: (result) => {
      const rows = result.data; if (!rows.length || rows.length < 2) { setUploadError('That file does not contain a header and at least one data row.'); return; }
      const columns = rows[0].map((v) => String(v ?? '').trim()); const dataRows = rows.slice(1).map(row => columns.map((_, i) => row[i] ?? null));
      const request = { fileName: file.name, columns, rows: dataRows };
      setLastRequest(request);
      executeAnalysis(request);
    }, error: () => setUploadError('We could not read that CSV. Check its encoding and delimiter, then try again.') });
  };
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) processFile(file); e.target.value = ''; };
  const refresh = () => {
    if (lastRequest && !loading) {
      executeAnalysis(lastRequest);
    }
  };

  const exportReport = () => {
    if (!analysis) return;
    const lines = [
      `# Customer churn analysis — ${analysis.fileName}`,
      '',
      '## Executive summary',
      `- ${analysis.overview.rows.toLocaleString()} customers across ${analysis.overview.columns} columns.`,
      `- Churn rate: ${pct(analysis.overview.churnRate)} (${analysis.overview.churned.toLocaleString()} churned; ${analysis.overview.retained.toLocaleString()} retained).`,
      `- Average monthly charges: ${money(analysis.overview.avgMonthlyCharges)}.`,
      '',
      '## Data quality',
      ...analysis.quality.issues.map((issue) => `- ${issue}`),
      '',
      '## Key findings',
      ...analysis.insights.map((insight) => `- ${insight}`),
      '',
      '## Customer segments',
      ...analysis.segments.map((segment) => `- ${segment.name}: ${segment.customers.toLocaleString()} customers, ${pct(segment.churnRate)} churn, ${segment.risk}. ${segment.characteristics}`),
      '',
      '## Business recommendations',
      ...analysis.recommendations.flatMap((recommendation, index) => [
        `### ${index + 1}. ${recommendation.problem}`,
        `- Evidence: ${recommendation.evidence}`,
        `- Action: ${recommendation.action}`,
        `- Objective: ${recommendation.objective}`,
        `- Target segment: ${recommendation.segment}`,
      ]),
      '',
      '## Statistical analysis',
      ...analysis.statisticalAnalysis.tests.flatMap((test) => [
        `- ${test.feature}: ${test.test}; ${test.statisticName} = ${test.statistic.toFixed(3)}; p = ${test.pValue === null ? 'not estimable' : test.pValue}; BH-adjusted p = ${test.adjustedPValue === null ? 'not estimable' : test.adjustedPValue}; effect = ${test.effectSize === null ? 'not estimable' : `${test.effectSize} (${test.effectSizeLabel})`}; ${test.significant ? 'statistically significant' : 'not statistically significant'}.`,
        ...(test.groups.length ? [`  Groups: ${test.groups.map((group) => `${group.group} ${pct(group.churnRate)} (${group.churned}/${group.total})`).join('; ')}`] : []),
      ]),
      '',
      '## Predictive modeling',
      `- Class distribution: ${analysis.predictiveModeling.classDistribution.positive.toLocaleString()} churned (${pct(analysis.predictiveModeling.classDistribution.positiveRate * 100)}) and ${analysis.predictiveModeling.classDistribution.negative.toLocaleString()} retained; ratio ${analysis.predictiveModeling.classDistribution.imbalanceRatio.toFixed(2)}:1.`,
      `- Best held-out ROC-AUC model: ${analysis.predictiveModeling.bestModel}.`,
      `- Retention-oriented recommendation: ${analysis.predictiveModeling.recommendedModel} at threshold ${analysis.predictiveModeling.recommendedThreshold.toFixed(2)}.`,
      `- Split: ${analysis.predictiveModeling.trainSize.toLocaleString()} training rows and ${analysis.predictiveModeling.testSize.toLocaleString()} test rows.`,
      ...analysis.predictiveModeling.models.flatMap((model) => [
        `- Baseline ${model.model}: accuracy ${pct(model.accuracy * 100)}, precision ${pct(model.precision * 100)}, recall ${pct(model.recall * 100)}, F1 ${pct(model.f1 * 100)}, ROC-AUC ${model.rocAuc.toFixed(3)}.`,
        `  Confusion matrix: TP ${model.confusionMatrix.truePositive}, FP ${model.confusionMatrix.falsePositive}, TN ${model.confusionMatrix.trueNegative}, FN ${model.confusionMatrix.falseNegative}.`,
        `  Top predictive features: ${model.featureImportance.slice(0, 5).map((feature) => `${feature.feature} (${pct(feature.importance * 100)})`).join(', ') || 'not available'}.`,
      ]),
      ...analysis.predictiveModeling.adjustedModels.flatMap((model) => [
        `- Adjusted ${model.model}: accuracy ${pct(model.accuracy * 100)}, precision ${pct(model.precision * 100)}, recall ${pct(model.recall * 100)}, F1 ${pct(model.f1 * 100)}, ROC-AUC ${model.rocAuc.toFixed(3)}.`,
        `  Confusion matrix: TP ${model.confusionMatrix.truePositive}, FP ${model.confusionMatrix.falsePositive}, TN ${model.confusionMatrix.trueNegative}, FN ${model.confusionMatrix.falseNegative}.`,
        `  Top predictive features: ${model.featureImportance.slice(0, 5).map((feature) => `${feature.feature} (${pct(feature.importance * 100)})`).join(', ') || 'not available'}.`,
      ]),
      `- ${analysis.predictiveModeling.selectionRationale}`,
      ...analysis.predictiveModeling.thresholdAnalysis.filter((row) => row.model === analysis.predictiveModeling.recommendedModel).map((row) => `- Threshold ${row.threshold.toFixed(2)} for ${row.model}: precision ${pct(row.precision * 100)}, recall ${pct(row.recall * 100)}, F1 ${pct(row.f1 * 100)}, flagged ${pct(row.predictedPositiveRate * 100)}.`),
      '',
      '## Method notes',
      ...analysis.methodology.map((method) => `- ${method}`),
      '',
      '## Limitations',
      ...analysis.limitations.map((limitation) => `- ${limitation}`),
      '',
      ...analysis.transformations.map((transformation) => `- ${transformation}`),
      '',
      '_Associations in this report do not establish causation._',
    ].join('\n');
    textDownload(lines, 'customer-churn-analysis.md');
  };

  return <div className="min-h-[100dvh] bg-background text-foreground">
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur print-hidden"><div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-8">
      <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><BarChart3 size={18} /></div><div><div className="text-sm font-bold tracking-[-.02em]">Retain<span className="text-accent">/</span>IQ</div><div className="font-mono text-[9px] uppercase tracking-[.16em] text-muted-foreground">Churn analytics</div></div></div>
      <div className="flex items-center gap-2"><input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFileChange} data-testid="input-file-upload" /><button type="button" onClick={() => fileRef.current?.click()} data-testid="button-upload-another" className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground transition hover:opacity-90"><Upload size={14} /><span className="hidden sm:inline">{analysis ? 'Upload another' : 'Upload CSV'}</span></button><div className="relative" ref={dropdownRef}><div className="flex h-9 items-center rounded-md border border-border bg-card"><button type="button" onClick={refresh} disabled={!analysis || loading} className="flex h-full items-center gap-2 px-3 text-xs font-semibold hover:bg-muted disabled:opacity-40" data-testid="button-refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /><span className="hidden sm:inline">Refresh</span></button><span className="h-5 w-px bg-border" /><button type="button" onClick={() => setMenuOpen(v => !v)} className="flex h-full items-center px-2 hover:bg-muted" aria-label="Open refresh options" data-testid="button-refresh-options"><ChevronDown size={14} /></button></div>{menuOpen && <div className="absolute right-0 top-11 w-64 rounded-lg border border-border bg-card p-3 shadow-xl"><div className="flex items-center justify-between border-b border-border pb-3"><div><p className="text-xs font-bold">Auto-refresh</p><p className="mt-0.5 text-[11px] text-muted-foreground">Off by default</p></div><button type="button" onClick={() => setAutoRefresh(v => !v)} aria-label="Toggle auto-refresh" data-testid="button-toggle-auto-refresh" className={`relative h-5 w-9 rounded-full transition ${autoRefresh ? 'bg-primary' : 'bg-muted'}`}><span className={`absolute top-1 h-3 w-3 rounded-full bg-card transition ${autoRefresh ? 'left-5' : 'left-1'}`} /></button></div><div className="pt-2">{INTERVALS.map(option => <button type="button" key={option.ms} onClick={() => { setIntervalMs(option.ms); setAutoRefresh(true); setMenuOpen(false); }} data-testid={`button-interval-${option.ms}`} className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-xs hover:bg-muted"><span>{option.label}</span>{intervalMs === option.ms && autoRefresh && <Check size={14} className="text-primary" />}</button>)}</div></div>}</div><IconButton label="Export PDF" onClick={() => window.print()} disabled={!analysis}>{<Printer size={14} />}</IconButton><button type="button" onClick={() => setIsDark(v => !v)} aria-label="Toggle dark mode" data-testid="button-toggle-dark-mode" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition hover:bg-muted">{isDark ? <Sun size={15} /> : <Moon size={15} />}</button></div>
    </div></header>
    {uploadError && <div className="mx-auto mt-4 flex max-w-[1440px] items-center gap-2 px-4 text-sm text-destructive sm:px-8"><AlertCircle size={16} />{uploadError}</div>}
    {loading ? <LoadingView /> : analysis ? <Dashboard data={analysis} lastRefreshed={lastRefreshed} onExportReport={exportReport} /> : <EmptyState onUpload={() => fileRef.current?.click()} />}
    <footer className="mx-auto flex max-w-[1440px] items-center justify-between px-4 pb-7 pt-3 text-[11px] text-muted-foreground sm:px-8"><span className="flex items-center gap-2">Retain/IQ · Evidence before action <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5"><i className="h-1.5 w-1.5 rounded-full bg-primary" />Local engine ready</span></span><span>{lastRefreshed ? `Last analyzed ${lastRefreshed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'No dataset loaded'}</span></footer>
  </div>;
}

function Metric({ label, value, note, tone = 'primary' }: { label: string; value: string; note: string; tone?: 'primary' | 'accent' | 'danger' | 'neutral' }) {
  return <div className="rounded-xl border border-border bg-card p-4"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">{label}</p><span className={`h-2 w-2 rounded-full ${tone === 'danger' ? 'bg-destructive' : tone === 'accent' ? 'bg-accent' : tone === 'neutral' ? 'bg-muted-foreground' : 'bg-primary'}`} /></div><p className="metric-value mt-3 text-2xl font-bold" style={{ color: tone === 'danger' ? '#b64a45' : tone === 'accent' ? '#de7b32' : tone === 'neutral' ? 'hsl(var(--foreground))' : '#276d68' }}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>;
}

function ChartTip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: unknown; color?: string }>; label?: string }) { if (!active || !payload?.length) return null; return <div className="chart-tooltip"><p className="mb-1 font-bold">{label}</p>{payload.map((p, i) => <div key={i} className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5 text-muted-foreground"><i className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}</span><b>{typeof p.value === 'number' ? p.value.toLocaleString() : String(p.value)}</b></div>)}</div>; }

function formatPValue(value: number | null) {
  if (value === null) return '—';
  if (value < 0.001) return '<0.001';
  return value.toFixed(3);
}

function StatisticalAnalysisCard({ data }: { data: AnalyzeResponse }) {
  const tests = data.statisticalAnalysis.tests;
  const exportRows = tests.map((test) => ({
    feature: test.feature,
    variableType: test.variableType,
    test: test.test,
    statistic: test.statistic,
    pValue: test.pValue,
    adjustedPValue: test.adjustedPValue,
    effectSize: test.effectSize,
    effectSizeLabel: test.effectSizeLabel,
    significant: test.significant,
  }));
  return <Card title="Statistical inference" eyebrow="Beyond descriptive rates" exportRows={exportRows} exportName="statistical-tests.csv">
    <div className="mb-3 rounded-lg bg-muted/70 p-3 text-xs leading-5 text-muted-foreground"><b className="text-foreground">Correction:</b> {data.statisticalAnalysis.correction} <span className="mx-1">·</span> α = {data.statisticalAnalysis.alpha}</div>
    {tests.length ? <div className="space-y-2">{tests.map((test, index) => <details key={test.feature} open={index < 2} className="rounded-lg border border-border bg-background/40 p-3">
      <summary className="cursor-pointer list-none"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><b className="text-sm">{test.feature}</b><span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{test.variableType}</span></div><span className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${test.significant ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>{test.significant ? 'Significant' : 'Not significant'}</span></div><div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-5"><span><em className="not-italic text-muted-foreground">Test</em><b className="block">{test.test}</b></span><span><em className="not-italic text-muted-foreground">{test.statisticName}</em><b className="block font-mono">{test.statistic.toFixed(3)}</b></span><span><em className="not-italic text-muted-foreground">p-value</em><b className="block font-mono">{formatPValue(test.pValue)}</b></span><span><em className="not-italic text-muted-foreground">BH-adjusted p</em><b className="block font-mono">{formatPValue(test.adjustedPValue)}</b></span><span><em className="not-italic text-muted-foreground">Effect</em><b className="block">{test.effectSize === null ? '—' : `${test.effectSize.toFixed(2)} · ${test.effectSizeLabel}`}</b></span></div></summary>
      <div className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground"><p>{test.notes}</p>{test.groups.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{test.groups.map((group) => <span key={group.group} className={`rounded border px-2 py-1 ${group.reliable ? 'border-primary/20 bg-primary/5' : 'border-accent/30 bg-accent/10'}`}><b className="text-foreground">{group.group}</b> {group.churnRate.toFixed(1)}% ({group.churned}/{group.total})</span>)}</div>}</div>
    </details>)}</div> : <Blank text="Statistical tests require a detected binary churn target." />}
    <div className="mt-3 space-y-1.5">{data.statisticalAnalysis.notes.map((note, index) => <p key={index} className="flex gap-2 text-xs leading-5 text-muted-foreground"><CircleHelp size={14} className="mt-0.5 shrink-0 text-accent" />{note}</p>)}</div>
  </Card>;
}

function ModelMetricsTable({ title, models, bestModel }: { title: string; models: AnalyzeResponse['predictiveModeling']['models']; bestModel?: string }) {
  return <div><p className="mb-2 text-xs font-bold text-primary">{title}</p>{models.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead><tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground"><th className="pb-2">Model</th><th className="pb-2">Accuracy</th><th className="pb-2">Precision</th><th className="pb-2">Recall</th><th className="pb-2">F1</th><th className="pb-2">ROC-AUC</th></tr></thead><tbody>{models.map((model) => <tr key={model.model} className="border-b border-border/60 last:border-0"><td className="py-3 font-semibold">{model.model}{model.model === bestModel && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">best baseline AUC</span>}</td><td className="py-3 font-mono">{pct(model.accuracy * 100)}</td><td className="py-3 font-mono">{pct(model.precision * 100)}</td><td className="py-3 font-mono">{pct(model.recall * 100)}</td><td className="py-3 font-mono">{pct(model.f1 * 100)}</td><td className="py-3 font-mono font-bold">{model.rocAuc.toFixed(3)}</td></tr>)}</tbody></table></div> : <Blank text="Not enough labeled data for a stable model comparison." />}</div>;
}

function PredictiveModelingCard({ data }: { data: AnalyzeResponse }) {
  const modeling = data.predictiveModeling;
  const recommended = modeling.adjustedModels.find((model) => model.model === modeling.recommendedModel);
  const thresholdRows = modeling.thresholdAnalysis.filter((row) => row.model === modeling.recommendedModel);
  const adjustedCurves = modeling.precisionRecallCurves.filter((curve) => curve.model.includes('·'));
  const curveData = Array.from({ length: Math.max(0, ...adjustedCurves.map((curve) => curve.points.length)) }, (_, index) => {
    const point = adjustedCurves[0]?.points[index];
    return { threshold: point?.threshold ?? 0, recall: point?.recall ?? 0, ...Object.fromEntries(adjustedCurves.map((curve, curveIndex) => [`curve${curveIndex}`, curve.points[index]?.precision ?? 0])) };
  });
  const exportRows = [...modeling.models.map((model) => ({ comparison: 'Baseline', model: model.model, accuracy: model.accuracy, precision: model.precision, recall: model.recall, f1: model.f1, rocAuc: model.rocAuc, ...model.confusionMatrix })), ...modeling.adjustedModels.map((model) => ({ comparison: 'Adjusted', model: model.model, accuracy: model.accuracy, precision: model.precision, recall: model.recall, f1: model.f1, rocAuc: model.rocAuc, ...model.confusionMatrix })), ...modeling.thresholdAnalysis.map((row) => ({ comparison: 'Threshold', ...row, ...row.confusionMatrix }))];
  return <Card title="Churn prediction benchmark" eyebrow="Baseline vs imbalance-adjusted" exportRows={exportRows} exportName="model-comparison-and-thresholds.csv">
    <div className="mb-3 grid gap-2 sm:grid-cols-3"><div className="rounded-lg bg-muted p-3"><p className="text-[10px] text-muted-foreground">Churned</p><p className="metric-value mt-1 text-lg font-bold text-destructive">{modeling.classDistribution.positive.toLocaleString()} ({pct(modeling.classDistribution.positiveRate * 100)})</p></div><div className="rounded-lg bg-muted p-3"><p className="text-[10px] text-muted-foreground">Retained</p><p className="metric-value mt-1 text-lg font-bold">{modeling.classDistribution.negative.toLocaleString()} ({pct((1 - modeling.classDistribution.positiveRate) * 100)})</p></div><div className="rounded-lg bg-muted p-3"><p className="text-[10px] text-muted-foreground">Negative:positive ratio</p><p className="metric-value mt-1 text-lg font-bold">{modeling.classDistribution.imbalanceRatio.toFixed(2)}:1</p></div></div>
    <div className="mb-4 rounded-lg bg-primary/10 p-3 text-xs leading-5 text-muted-foreground"><b className="text-foreground">Retention recommendation:</b> {modeling.selectionRationale}<br /><span className="text-[11px]">ROC-AUC remains useful for ranking, but the recommendation also considers threshold-specific recall, precision, and F1. The result is predictive evidence, not causal evidence.</span></div>
    <div className="space-y-4"><ModelMetricsTable title="Baseline models · default threshold 0.50" models={modeling.models} bestModel={modeling.bestModel} /><ModelMetricsTable title="Imbalance-adjusted models · same held-out test set" models={modeling.adjustedModels} /></div>
    {recommended && <div className="mt-4 rounded-lg border border-border p-3"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-bold">Recommended model features · {recommended.model}</p><span className="text-[10px] text-muted-foreground">predictive, not causal</span></div><div className="space-y-2">{recommended.featureImportance.slice(0, 8).map((feature) => <div key={feature.feature}><div className="mb-1 flex justify-between text-[11px]"><span>{feature.feature}</span><span className="font-mono text-muted-foreground">{(feature.importance * 100).toFixed(1)}%</span></div><div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, feature.importance * 100)}%` }} /></div></div>)}</div></div>}
    {thresholdRows.length > 0 && <div className="mt-4"><p className="mb-2 text-xs font-bold text-primary">Threshold tradeoff · {modeling.recommendedModel}</p><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead><tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground"><th className="pb-2">Threshold</th><th className="pb-2">Precision</th><th className="pb-2">Recall</th><th className="pb-2">F1</th><th className="pb-2">Flagged</th><th className="pb-2">Confusion matrix</th></tr></thead><tbody>{thresholdRows.map((row) => <tr key={row.threshold} className={`border-b border-border/60 last:border-0 ${row.threshold === modeling.recommendedThreshold ? 'bg-primary/10' : ''}`}><td className="py-2 font-mono">{row.threshold.toFixed(2)}{row.threshold === modeling.recommendedThreshold && <span className="ml-1 text-primary">recommended</span>}</td><td className="py-2 font-mono">{pct(row.precision * 100)}</td><td className="py-2 font-mono">{pct(row.recall * 100)}</td><td className="py-2 font-mono">{pct(row.f1 * 100)}</td><td className="py-2 font-mono">{pct(row.predictedPositiveRate * 100)}</td><td className="py-2 font-mono text-[11px]">TP {row.confusionMatrix.truePositive} · FP {row.confusionMatrix.falsePositive} · TN {row.confusionMatrix.trueNegative} · FN {row.confusionMatrix.falseNegative}</td></tr>)}</tbody></table></div></div>}
    {curveData.length > 0 && <div className="mt-4"><p className="mb-2 text-xs font-bold text-primary">Precision–recall curves · adjusted models</p><ResponsiveContainer width="100%" height={250}><LineChart data={curveData} margin={{ top: 8, right: 10, bottom: 18, left: 0 }}><CartesianGrid stroke="hsl(var(--border))" /><XAxis dataKey="recall" type="number" domain={[0, 1]} tickFormatter={(value) => `${Math.round(value * 100)}%`} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} label={{ value: 'Recall', position: 'insideBottom', offset: -10, fontSize: 10 }} /><YAxis domain={[0, 1]} tickFormatter={(value) => `${Math.round(value * 100)}%`} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><Tooltip formatter={(value: number) => pct(value * 100)} labelFormatter={(value) => `Recall ${pct(Number(value) * 100)}`} />{adjustedCurves.map((curve, index) => <Line key={curve.model} type="monotone" dataKey={`curve${index}`} name={curve.model} stroke={COLORS[index + 1] || COLORS[0]} strokeWidth={2} dot={false} />)}</LineChart></ResponsiveContainer></div>}
    <div className="mt-4 space-y-1.5">{modeling.notes.map((note, index) => <p key={index} className="flex gap-2 text-xs leading-5 text-muted-foreground"><CircleHelp size={14} className="mt-0.5 shrink-0 text-accent" />{note}</p>)}{modeling.leakageChecks.map((check, index) => <p key={`leakage-${index}`} className="flex gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />{check}</p>)}</div>
  </Card>;
}

function Dashboard({ data, lastRefreshed, onExportReport }: { data: AnalyzeResponse; lastRefreshed?: Date; onExportReport: () => void }) {
  const [activeBreakdown, setActiveBreakdown] = useState(0);
  const [activeDistribution, setActiveDistribution] = useState(Object.keys(data.distributions)[0] || '');
  const [activeTab, setActiveTab] = useState<'overview' | 'data'>('overview');
  const overview = data.overview;
  const qualityScore = Math.max(0, Math.round(100 - ((data.quality.missingCells + data.quality.invalidValues + data.quality.duplicateRows) / Math.max(1, overview.rows * overview.columns)) * 100));
  const breakdown = data.breakdowns[activeBreakdown];
  const distribution = data.distributions[activeDistribution] || [];
  const scatter = data.scatter.slice(0, 1200);
  const previewColumns = data.preview.length ? Object.keys(data.preview[0]) : [];
  const segmentRows = data.segments.map(s => ({ segment: s.name, customers: s.customers, churnRate: s.churnRate, avgCharges: s.avgCharges, avgTenure: s.avgTenure }));
  const previewRows = data.preview.map(row => previewColumns.reduce((acc, key) => ({ ...acc, [key]: row[key] }), {}));
  const reportRows = data.recommendations;

  return <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-7 sm:px-8">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-5"><div><div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-muted-foreground"><span className="rounded bg-primary/10 px-2 py-1 text-primary">Live analysis</span><span className="font-mono normal-case tracking-normal">{data.fileName}</span></div><h1 className="text-3xl font-bold tracking-[-.055em] sm:text-4xl">Customer health, in context.</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">A measured view of {overview.rows.toLocaleString()} customers. The strongest signals are highlighted below; they are not predictions of individual outcomes.</p></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="hidden sm:inline">{lastRefreshed ? `Analyzed ${lastRefreshed.toLocaleString()}` : ''}</span><button type="button" onClick={onExportReport} data-testid="button-export-report" className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 font-semibold text-foreground transition hover:bg-muted"><Download size={14} /> Export report</button></div></div>
    <div className="mb-4 flex items-center gap-1 border-b border-border"><button type="button" onClick={() => setActiveTab('overview')} data-testid="button-tab-overview" className={`border-b-2 px-3 pb-3 text-xs font-bold ${activeTab === 'overview' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>Overview</button><button type="button" onClick={() => setActiveTab('data')} data-testid="button-tab-data" className={`border-b-2 px-3 pb-3 text-xs font-bold ${activeTab === 'data' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>Data profile</button></div>
    {activeTab === 'data' ? <DataProfile data={data} previewColumns={previewColumns} previewRows={previewRows} /> : <><div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Customers" value={compact(overview.rows)} note={`${overview.columns} columns in source`} /><Metric label="Churn rate" value={pct(overview.churnRate)} note={`${overview.churned.toLocaleString()} customers churned`} tone="danger" /><Metric label="Avg. monthly charges" value={money(overview.avgMonthlyCharges)} note="Across all customers" tone="accent" /><Metric label="Data confidence" value={`${qualityScore}/100`} note={`${data.quality.issues.length} quality findings`} tone="neutral" /></div>
      <div className="mb-4 grid gap-4 lg:grid-cols-[1.3fr_.7fr]"><Card title="Churn balance" eyebrow="Portfolio view" exportRows={[{ label: data.target.positiveLabel, customers: overview.churned }, { label: data.target.negativeLabel, customers: overview.retained }]} exportName="churn-balance.csv"><div className="grid gap-4 sm:grid-cols-[1fr_170px]"><div><div className="mb-3 flex items-end justify-between"><div><p className="metric-value text-4xl font-bold text-destructive">{pct(overview.churnRate)}</p><p className="mt-1 text-xs text-muted-foreground">of the analyzed base is marked {data.target.positiveLabel || 'churned'}</p></div><div className="text-right text-xs text-muted-foreground"><p><b className="text-foreground">{overview.retained.toLocaleString()}</b> retained</p><p><b className="text-destructive">{overview.churned.toLocaleString()}</b> churned</p></div></div><div className="flex h-3 overflow-hidden rounded-full bg-primary/10"><div className="bg-destructive" style={{ width: `${overview.churnRate}%` }} /><div className="bg-primary" style={{ width: `${100 - overview.churnRate}%` }} /></div><div className="mt-5 grid grid-cols-3 gap-2 text-xs"><div className="rounded-lg bg-muted p-3"><span className="text-muted-foreground">Avg tenure</span><b className="mt-1 block">{overview.avgTenure.toFixed(1)} mo</b></div><div className="rounded-lg bg-muted p-3"><span className="text-muted-foreground">Target column</span><b className="mt-1 block truncate">{data.target.column || 'Detected'}</b></div><div className="rounded-lg bg-muted p-3"><span className="text-muted-foreground">Numeric fields</span><b className="mt-1 block">{overview.numericColumns.length}</b></div></div></div><div className="flex items-center justify-center"><div className="relative h-36 w-36 rounded-full" style={{ background: `conic-gradient(#b64a45 ${overview.churnRate}%, #276d68 0)` }}><div className="absolute inset-4 flex flex-col items-center justify-center rounded-full bg-card"><span className="metric-value text-2xl font-bold">{pct(overview.churnRate)}</span><span className="text-[10px] uppercase tracking-widest text-muted-foreground">churn</span></div></div></div></div></Card><Card title="Evidence at a glance" eyebrow="Analyst readout" exportRows={data.insights.map((insight, i) => ({ order: i + 1, insight }))} exportName="evidence-at-a-glance.csv"><div className="space-y-3">{data.insights.slice(0, 4).map((insight, i) => <div key={i} data-testid={`text-insight-${i}`} className="flex gap-3 rounded-lg border border-border bg-background/60 p-3"><span className="font-mono text-xs text-accent">0{i + 1}</span><p className="text-sm leading-5">{insight}</p></div>)}</div></Card></div>
      <div className="mb-4 grid gap-4 lg:grid-cols-2"><Card title="Where churn concentrates" eyebrow="Breakdown" exportRows={(breakdown?.rows || []).map(r => ({ dimension: breakdown?.dimension, ...r }))} exportName="churn-breakdown.csv"><div className="mb-4 flex gap-2 overflow-x-auto">{data.breakdowns.map((item, i) => <button type="button" key={item.dimension} onClick={() => setActiveBreakdown(i)} data-testid={`button-breakdown-${i}`} className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold ${i === activeBreakdown ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{item.dimension}</button>)}</div>{breakdown ? <ResponsiveContainer width="100%" height={260}><BarChart data={breakdown.rows} layout="vertical" margin={{ left: 4, right: 12 }}><CartesianGrid horizontal={false} stroke="hsl(var(--border))" /><XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => `${v}%`} /><YAxis dataKey="label" type="category" width={90} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} /><Tooltip content={<ChartTip />} cursor={{ fill: 'hsl(var(--muted)/.5)' }} /><Bar dataKey="rate" name="Churn rate" fill="#b64a45" radius={[0, 4, 4, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer> : <Blank text="No breakdowns were returned for this file." />}</Card><Card title="Feature distribution" eyebrow="Shape of the data" exportRows={distribution.map(d => ({ feature: activeDistribution, ...d }))} exportName="feature-distribution.csv"><div className="mb-4 flex items-center gap-2"><select value={activeDistribution} onChange={e => setActiveDistribution(e.target.value)} data-testid="select-distribution-feature" className="h-8 max-w-full rounded-md border border-border bg-background px-2 text-xs font-semibold">{Object.keys(data.distributions).map(key => <option key={key} value={key}>{key}</option>)}</select><span className="text-[11px] text-muted-foreground">churned vs retained</span></div>{distribution.length ? <ResponsiveContainer width="100%" height={260}><BarChart data={distribution} margin={{ bottom: 8 }}><CartesianGrid vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} interval={0} angle={-25} textAnchor="end" height={55} /><YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} /><Tooltip content={<ChartTip />} /><Bar dataKey="retained" name="Retained" fill="#276d68" radius={[3,3,0,0]} isAnimationActive={false} /><Bar dataKey="churned" name="Churned" fill="#b64a45" radius={[3,3,0,0]} isAnimationActive={false} /></BarChart></ResponsiveContainer> : <Blank text="No distribution bins were returned." />}</Card></div>
      <div className="mb-4 grid gap-4 lg:grid-cols-[.85fr_1.15fr]"><Card title="Signals that move together" eyebrow="Correlation scan" exportRows={data.correlations} exportName="correlations.csv"><div className="space-y-3">{data.correlations.slice(0, 7).map((corr, i) => <div key={corr.feature} data-testid={`row-correlation-${i}`}><div className="mb-1 flex items-center justify-between text-xs"><span className="font-semibold">{corr.feature}</span><span className="font-mono text-muted-foreground">{corr.value.toFixed(2)} · {corr.strength}</span></div><div className="h-2 rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.abs(corr.value) * 100)}%`, background: corr.value >= 0 ? '#de7b32' : '#276d68' }} /></div></div>)}</div></Card><Card title="Tenure and charges" eyebrow="Relationship view" exportRows={scatter} exportName="tenure-charges.csv"><div className="mb-3 flex items-center gap-4 text-[11px] text-muted-foreground"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-primary" />Retained</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-destructive" />Churned</span></div>{scatter.length ? <ResponsiveContainer width="100%" height={270}><ScatterChart margin={{ top: 10, right: 18, bottom: 12, left: 0 }}><CartesianGrid stroke="hsl(var(--border))" /><XAxis type="number" dataKey="x" name="Tenure" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} label={{ value: 'Tenure', position: 'insideBottom', offset: -5, fontSize: 11 }} /><YAxis type="number" dataKey="y" name="Monthly charges" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} /><Tooltip content={<ChartTip />} /><ReferenceLine y={overview.avgMonthlyCharges} stroke="#de7b32" strokeDasharray="4 4" /><Scatter name="Customers" data={scatter.filter(p => !p.churned)} fill="#276d68" fillOpacity={.55} /><Scatter name="Churned" data={scatter.filter(p => p.churned)} fill="#b64a45" fillOpacity={.68} /></ScatterChart></ResponsiveContainer> : <Blank text="No scatter points were returned." />}</Card></div>
       <div className="mb-4 grid gap-4 lg:grid-cols-2"><StatisticalAnalysisCard data={data} /><PredictiveModelingCard data={data} /></div>
       <div className="mb-4 grid gap-4 lg:grid-cols-2"><Card title="Methodology and limitations" eyebrow="Statistical audit" exportRows={[...data.methodology.map((item, i) => ({ category: 'Methodology', order: i + 1, item })), ...data.limitations.map((item, i) => ({ category: 'Limitation', order: i + 1, item }))]} exportName="methodology-limitations.csv"><div className="grid gap-4 sm:grid-cols-2"><div><p className="mb-2 text-xs font-bold text-primary">Methodology</p><div className="space-y-2">{data.methodology.map((item, index) => <p key={index} className="flex gap-2 text-xs leading-5 text-muted-foreground"><Check size={14} className="mt-0.5 shrink-0 text-primary" />{item}</p>)}</div></div><div><p className="mb-2 text-xs font-bold text-accent">Limitations and audit checks</p><div className="space-y-2">{data.limitations.map((item, index) => <p key={index} className="flex gap-2 text-xs leading-5 text-muted-foreground"><CircleHelp size={14} className="mt-0.5 shrink-0 text-accent" />{item}</p>)}</div></div></div></Card></div>
       <div className="mb-4 grid gap-4 lg:grid-cols-[1.15fr_.85fr]"><Card title="Segments to watch" eyebrow="Customer groups" exportRows={segmentRows} exportName="customer-segments.csv"><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead><tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground"><th className="pb-2">Segment</th><th className="pb-2">Customers</th><th className="pb-2">Churn</th><th className="pb-2">Charges</th><th className="pb-2">Tenure</th></tr></thead><tbody>{data.segments.map((s, i) => <tr key={s.name} data-testid={`row-segment-${i}`} className="border-b border-border/60 last:border-0"><td className="py-3"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${s.risk.toLowerCase().includes('high') ? 'bg-destructive' : 'bg-accent'}`} /><div><b>{s.name}</b><p className="mt-0.5 max-w-[220px] truncate text-[11px] text-muted-foreground">{s.characteristics}</p></div></div></td><td className="py-3 font-mono">{s.customers.toLocaleString()}</td><td className="py-3 font-mono font-bold text-destructive">{pct(s.churnRate)}</td><td className="py-3 font-mono">{money(s.avgCharges)}</td><td className="py-3 font-mono">{s.avgTenure.toFixed(1)} mo</td></tr>)}</tbody></table></div></Card><Card title="Transformations applied" eyebrow="Method notes" exportRows={data.transformations.map((transformation, i) => ({ step: i + 1, transformation }))} exportName="transformations.csv"><div className="space-y-2">{data.transformations.length ? data.transformations.map((t, i) => <div key={i} className="flex gap-2 rounded-md bg-muted/60 p-2.5 text-xs leading-5"><Check size={14} className="mt-0.5 shrink-0 text-primary" />{t}</div>) : <Blank text="No transformations were reported." />}</div></Card></div>
      <div className="mb-4 grid gap-4 lg:grid-cols-3"><Card title="Recommended next moves" eyebrow="Action brief" exportRows={reportRows} exportName="recommended-next-moves.csv">{data.recommendations.length ? <div className="space-y-3">{data.recommendations.map((r, i) => <article key={i} data-testid={`card-recommendation-${i}`} className="rounded-lg border border-border bg-background/50 p-4"><div className="mb-2 flex items-start justify-between gap-3"><h3 className="text-sm font-bold">{r.problem}</h3><span className="shrink-0 rounded bg-accent/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-accent-foreground">{r.segment}</span></div><p className="text-xs leading-5 text-muted-foreground"><b className="text-foreground">Evidence:</b> {r.evidence}</p><p className="mt-2 text-xs leading-5"><b className="text-primary">Action:</b> {r.action}</p><p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground"><b>Objective:</b> {r.objective}</p></article>)}</div> : <Blank text="No recommendations were returned for this dataset." />}</Card><Card title="Data quality review" eyebrow="Trust layer" exportRows={data.quality.columnStats} exportName="data-quality.csv"><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[['Missing cells', data.quality.missingCells], ['Duplicate rows', data.quality.duplicateRows], ['Invalid values', data.quality.invalidValues], ['Outlier cells', data.quality.outlierCells], ['Inconsistent categories', data.quality.inconsistentCategories], ['High cardinality fields', data.quality.highCardinality.length]].map(([label, value], i) => <div key={i} className="rounded-lg bg-muted p-3"><p className="text-[10px] leading-4 text-muted-foreground">{label}</p><p className="metric-value mt-1 text-lg font-bold">{String(value)}</p></div>)}</div>{data.quality.issues.length > 0 && <div className="mt-3 space-y-1.5">{data.quality.issues.slice(0, 4).map((issue, i) => <p key={i} className="flex gap-2 text-xs leading-5 text-muted-foreground"><CircleHelp size={14} className="mt-0.5 shrink-0 text-accent" />{issue}</p>)}</div>}</Card><Card title="Data Quality Warnings" eyebrow="Validation guardrails" exportRows={data.quality.warnings.map((warning, i) => ({ order: i + 1, warning }))} exportName="data-quality-warnings.csv"><div className="mb-3 rounded-lg bg-accent/10 p-3 text-xs leading-5 text-muted-foreground"><b className="text-foreground">Minimum segment sample:</b> {data.quality.minimumSegmentSampleSize} customers</div>{data.quality.warnings.length ? <div className="space-y-2">{data.quality.warnings.map((warning, i) => <p key={i} data-testid={`text-quality-warning-${i}`} className="flex gap-2 text-xs leading-5 text-muted-foreground"><CircleHelp size={14} className="mt-0.5 shrink-0 text-accent" />{warning}</p>)}</div> : <Blank text="No data-quality warnings were generated." />}</Card></div>
    </>}
  </main>;
}

function DataProfile({ data, previewColumns, previewRows }: { data: AnalyzeResponse; previewColumns: string[]; previewRows: AnyRecord[] }) {
  return <div className="space-y-4"><div className="grid gap-4 lg:grid-cols-[.75fr_1.25fr]"><Card title="Source profile" eyebrow="Schema & dimensions" exportRows={data.quality.columnStats} exportName="column-profile.csv"><div className="grid grid-cols-2 gap-2"><div className="rounded-lg bg-muted p-3"><Database size={15} className="mb-3 text-primary" /><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Rows</p><b className="metric-value text-xl">{data.overview.rows.toLocaleString()}</b></div><div className="rounded-lg bg-muted p-3"><Table2 size={15} className="mb-3 text-primary" /><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Columns</p><b className="metric-value text-xl">{data.overview.columns}</b></div></div><div className="mt-4 space-y-3 text-xs"><div><p className="mb-1 font-bold text-muted-foreground">Numeric</p><p className="leading-5">{data.overview.numericColumns.join(', ') || 'None detected'}</p></div><div><p className="mb-1 font-bold text-muted-foreground">Categorical</p><p className="leading-5">{data.overview.categoricalColumns.join(', ') || 'None detected'}</p></div><div><p className="mb-1 font-bold text-muted-foreground">Dates</p><p className="leading-5">{data.overview.dateColumns.join(', ') || 'None detected'}</p></div></div></Card><Card title="Preview" eyebrow="First rows" exportRows={previewRows} exportName="data-preview.csv"><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead><tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">{previewColumns.map(c => <th key={c} className="max-w-[160px] truncate pb-2 pr-4">{c}</th>)}</tr></thead><tbody>{previewRows.slice(0, 8).map((row, i) => <tr key={i} data-testid={`row-preview-${i}`} className="border-b border-border/60 last:border-0">{previewColumns.map(c => <td key={c} className="max-w-[180px] truncate py-2.5 pr-4">{String(row[c] ?? '—')}</td>)}</tr>)}</tbody></table></div></Card></div><Card title="Column statistics" eyebrow="Field-level detail" exportRows={data.quality.columnStats} exportName="column-statistics.csv"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.quality.columnStats.map((stat, i) => <div key={stat.name} data-testid={`card-column-stat-${i}`} className="rounded-lg border border-border p-3"><div className="flex items-start justify-between gap-2"><b className="truncate text-sm">{stat.name}</b><span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">{stat.type}</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-[11px]"><span className="text-muted-foreground">Missing <b className="block text-foreground">{stat.missing}</b></span><span className="text-muted-foreground">Unique <b className="block text-foreground">{stat.unique}</b></span><span className="text-muted-foreground">Sample <b className="block truncate text-foreground">{stat.sample}</b></span></div></div>)}</div></Card></div>;
}

function Blank({ text }: { text: string }) { return <div className="flex min-h-[160px] items-center justify-center rounded-lg border border-dashed border-border px-5 text-center text-sm text-muted-foreground">{text}</div>; }

function App() { return <QueryClientProvider client={queryClient}><AppShell /></QueryClientProvider>; }
export default App;
