import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import ErrorBanner from './ui/ErrorBanner';
import EmptyState from './ui/EmptyState';
import Skeleton, { Block } from './ui/Skeleton';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts';

export default function AnalyticsDashboard() {
  const [surveyScope, setSurveyScope] = useState('all');
  const [surveys, setSurveys] = useState([]);
  const [surveyQuestions, setSurveyQuestions] = useState([]);
  const [customQuestionId, setCustomQuestionId] = useState('');
  const [customQuestionText, setCustomQuestionText] = useState('');
  const [customQuestionDistribution, setCustomQuestionDistribution] = useState([]);
  const [customQuestionLoading, setCustomQuestionLoading] = useState(false);
  const [summary, setSummary] = useState({
    totalFarmers: 0,
    completedSessions: 0,
    inProgressSessions: 0,
  });
  const [cropDistribution, setCropDistribution] = useState([]);
  const [regionStats, setRegionStats] = useState([]);
  const [seedUsage, setSeedUsage] = useState([]);
  const [fertilizerUsage, setFertilizerUsage] = useState([]);
  const [inputAvgIncome, setInputAvgIncome] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAnalytics = useCallback(async () => {
    try {
      const response = await axios.get('/api/analytics/summary', { params: { surveyId: surveyScope } });
      setSummary(response.data.summary || {});
      setCropDistribution(response.data.cropDistribution || []);
      setRegionStats(response.data.regionStats || []);
      setSeedUsage(response.data.seedUsage || []);
      setFertilizerUsage(response.data.fertilizerUsage || []);

      // fetch avg income by input usage
      try {
        const avgRes = await axios.get('/api/analytics/inputs/avg-income', { params: { surveyId: surveyScope } });
        const d = avgRes.data.data || {};
        setInputAvgIncome([
          { name: 'Improved Seeds', yes: d.improvedSeeds?.avgIncomeYes ?? null, no: d.improvedSeeds?.avgIncomeNo ?? null },
          { name: 'Fertilizer', yes: d.fertilizer?.avgIncomeYes ?? null, no: d.fertilizer?.avgIncomeNo ?? null },
          { name: 'Irrigation', yes: d.irrigation?.avgIncomeYes ?? null, no: d.irrigation?.avgIncomeNo ?? null },
        ]);
      } catch (err) {
        console.warn('Avg income fetch failed', err.message);
        setInputAvgIncome([]);
      }

      setError(null);
    } catch {
      setError('Failed to load analytics. Backend may be offline.');
    } finally {
      setLoading(false);
    }
  }, [surveyScope]);

  useEffect(() => {
    const fetchSurveys = async () => {
      try {
        const res = await axios.get('/api/survey/surveys');
        setSurveys(res.data?.surveys || []);
      } catch {
        setSurveys([]);
      }
    };

    fetchSurveys();
  }, []);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  useEffect(() => {
    if (!surveyScope || surveyScope === 'all') {
      setSurveyQuestions([]);
      setCustomQuestionId('');
      setCustomQuestionText('');
      setCustomQuestionDistribution([]);
      return;
    }

    let cancelled = false;
    const fetchQuestions = async () => {
      try {
        const res = await axios.get('/api/survey/questions', { params: { surveyId: surveyScope } });
        const questions = Array.isArray(res.data?.questions) ? res.data.questions : [];
        if (cancelled) return;

        setSurveyQuestions(questions);
        setCustomQuestionId((prev) => {
          const exists = questions.some((question) => question.id === prev);
          return exists ? prev : (questions[0]?.id || '');
        });
      } catch {
        if (cancelled) return;
        setSurveyQuestions([]);
        setCustomQuestionId('');
        setCustomQuestionText('');
        setCustomQuestionDistribution([]);
      }
    };

    fetchQuestions();
    return () => { cancelled = true; };
  }, [surveyScope]);

  useEffect(() => {
    if (!customQuestionId || !surveyScope || surveyScope === 'all') {
      setCustomQuestionText('');
      setCustomQuestionDistribution([]);
      return;
    }

    let cancelled = false;
    const fetchQuestionDistribution = async () => {
      setCustomQuestionLoading(true);
      try {
        const res = await axios.get('/api/analytics/questions/distribution', {
          params: { surveyId: surveyScope, questionId: customQuestionId },
        });
        const payload = res.data?.data || {};
        if (cancelled) return;

        setCustomQuestionText(payload.questionText || customQuestionId);
        setCustomQuestionDistribution(Array.isArray(payload.responses) ? payload.responses : []);
      } catch {
        if (cancelled) return;
        setCustomQuestionText('');
        setCustomQuestionDistribution([]);
      } finally {
        if (!cancelled) setCustomQuestionLoading(false);
      }
    };

    fetchQuestionDistribution();
    return () => { cancelled = true; };
  }, [customQuestionId, surveyScope]);

  const [debugOpen, _setDebugOpen] = useState(false);

  const handleExport = async () => {
    try {
      const response = await axios.get('/api/analytics/export', {
        params: { surveyId: surveyScope },
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'survey_export.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      alert('Export failed. Backend may be offline.');
    }
  };

  // Prepare data for charts
  const COLORS = ['#2ecc71', '#3498db', '#f1c40f', '#e67e22', '#e74c3c', '#9b59b6'];
  const defaultPieData = cropDistribution.map((c, i) => ({
    label: c.crop || c.name || `Crop ${i + 1}`,
    farmerCount: Number(c.count ?? c.farmerCount ?? 0),
    avgIncome: c.avgIncome ?? null,
    avgInputUsage: c.avgFertilizerUsage ?? c.avgInputUsage ?? null,
  }));

  const customPieData = customQuestionDistribution.map((item, i) => ({
    label: item.option || `Option ${i + 1}`,
    farmerCount: Number(item.count || 0),
    avgIncome: null,
    avgInputUsage: null,
  }));

  const showingCustomDistribution = Boolean(customQuestionId && surveyScope !== 'all');
  const pieData = showingCustomDistribution ? customPieData : defaultPieData;

  const titleCase = (s) => {
    if (!s) return s;
    return s.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  const selectedQuestion = surveyQuestions.find((question) => question.id === customQuestionId) || null;
  const selectedQuestionText = String(selectedQuestion?.text || customQuestionText || '').toLowerCase();
  const isCropQuestionSelected = Boolean(selectedQuestion) && (
    String(selectedQuestion.id || '').trim().toUpperCase() === 'Q1'
    || selectedQuestionText.includes('crop')
    || selectedQuestionText.includes('cultivat')
  );
  const pieTitle = showingCustomDistribution
    ? `${isCropQuestionSelected ? 'Crop Distribution' : 'Option Distribution'} — ${customQuestionText || customQuestionId}`
    : 'Crop Distribution';
  const hasPieData = pieData.some((entry) => Number(entry.farmerCount) > 0);
  const showPieDetailMetrics = !showingCustomDistribution || isCropQuestionSelected;

  // Aggregate backend regionStats client-side to collapse naming variants and ensure correct sums
  const aggregatedRegions = regionStats.reduce((acc, r) => {
    const raw = (r.region || r.state || 'unknown').toString();
    const key = raw.trim().toLowerCase().replace(/_/g, ' ');
    const farmers = Number(r.farmerCount || 0);
    const completed = Number(r.completedSessions || 0);
    if (!acc[key]) acc[key] = { regionKey: key, farmerCount: 0, completedSessions: 0, sources: 0 };
    acc[key].farmerCount += farmers;
    acc[key].completedSessions += completed;
    acc[key].sources += 1;
    return acc;
  }, {});

  const regionData = Object.values(aggregatedRegions).map(({ regionKey, farmerCount, completedSessions, sources }) => {
    let pct = farmerCount ? Math.round((completedSessions / farmerCount) * 100) : 0;
    if (!isFinite(pct) || pct < 0) pct = 0;
    if (pct > 100) {
      console.warn(`Analytics: aggregated region ${regionKey} computed completionPct > 100 (${pct}). Clamping to 100.`);
      pct = 100;
    }
    if (sources > 1) console.info(`Analytics: collapsed ${sources} region entries into ${regionKey}`);

    return {
      region: titleCase(regionKey),
      completionPct: pct,
      farmerCount: farmerCount,
      completedSessions: completedSessions,
    };
  }).sort((a, b) => b.farmerCount - a.farmerCount);

  // Input usage counts (derive from seedUsage/fertilizerUsage arrays if present)
  const getYesNo = (arr, yesLabel = 'Yes') => {
    const yes = arr.find((a) => a.response?.toString().toLowerCase() === yesLabel.toLowerCase());
    const no = arr.find((a) => a.response?.toString().toLowerCase() === 'no' || a.response?.toString().toLowerCase() === 'n');
    return { yes: yes?.count || 0, no: no?.count || 0 };
  };

  const seedsYN = getYesNo(seedUsage, 'Yes');
  const fertYN = getYesNo(fertilizerUsage, 'Yes');

  const inputCounts = [
    { name: 'Improved Seeds', yes: seedsYN.yes, no: seedsYN.no },
    { name: 'Fertilizer', yes: fertYN.yes, no: fertYN.no },
  ];

  const hasRegionData = regionData.length > 0;
  const hasInputCountData = inputCounts.some((entry) => Number(entry.yes || 0) > 0 || Number(entry.no || 0) > 0);
  const hasIncomeData = inputAvgIncome.some((entry) => Number.isFinite(entry.yes) || Number.isFinite(entry.no));

  return (
    <div>
      <div className="card">
        <h2>Analytics Dashboard</h2>
        <ErrorBanner message={error} onRetry={fetchAnalytics} />
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
          <select value={surveyScope} onChange={(e) => setSurveyScope(e.target.value)}>
            <option value="all">All Surveys</option>
            {surveys.map((survey) => (
              <option key={survey.id} value={survey.id}>{survey.name || survey.id}</option>
            ))}
          </select>
          <select
            value={customQuestionId}
            onChange={(e) => setCustomQuestionId(e.target.value)}
            disabled={surveyScope === 'all' || surveyQuestions.length === 0}
          >
            <option value="">{surveyScope === 'all' ? 'Select a survey for question graph' : 'Select question for graph'}</option>
            {surveyQuestions.map((question) => (
              <option key={question.id} value={question.id}>{`${question.id} — ${question.text || ''}`}</option>
            ))}
          </select>
          <button onClick={handleExport} style={{ marginBottom: '0' }}>
            Export to Excel
          </button>
          <button onClick={() => fetchAnalytics()} style={{ marginBottom: '0' }}>Refresh</button>
          {/* <button onClick={() => setDebugOpen((d) => !d)} style={{ marginBottom: '0' }}>{debugOpen ? 'Hide' : 'Show'} Raw Data</button> */}
        </div>

        <div className="card-grid" style={{ marginBottom: '1.5rem' }}>
          {loading ? (
            [1, 2, 3].map((i) => (
              <div key={i} className="stat-box">
                <Block />
              </div>
            ))
          ) : (
            <>
              <div className="stat-box">
                <h3>{summary.totalFarmers || 0}</h3>
                <p>Total Farmers</p>
              </div>
              <div className="stat-box" style={{ background: 'linear-gradient(135deg, #2ecc71 0%, #27ae60 100%)' }}>
                <h3>{summary.completedSessions || 0}</h3>
                <p>Completed Sessions</p>
              </div>
              <div className="stat-box" style={{ background: 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)' }}>
                <h3>{summary.inProgressSessions || 0}</h3>
                <p>In Progress</p>
              </div>
            </>
          )}
        </div>

        {debugOpen && (
          <div style={{ marginBottom: '1rem', fontSize: '0.9rem' }}>
            <details open>
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Raw analytics response (for debugging)</summary>
              <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto', padding: '0.5rem', background: '#f4f6f8', borderRadius: 6 }}>{JSON.stringify({ summary, cropDistribution, regionStats, seedUsage, fertilizerUsage, inputAvgIncome }, null, 2)}</pre>
            </details>
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch' }}>
            <div style={{ flex: 1 }}><Block height={260} /></div>
            <div style={{ flex: 1 }}><Block height={260} /></div>
          </div>
        ) : (
          (hasPieData || hasRegionData) ? (
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch' }}>
              {hasPieData && (
                <div style={{ flex: 1, minHeight: 260 }}>
                  <h3>{pieTitle}</h3>
                  {customQuestionLoading && <p style={{ color: '#7f8c8d' }}>Loading question graph...</p>}
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={pieData} dataKey="farmerCount" nameKey="label" innerRadius={60} outerRadius={100} fill="#8884d8" label={({ name, percent }) => `${name} (${Math.round(percent * 100)}%)`}>
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <ReTooltip formatter={(value, name, props) => {
                        const d = props?.payload || {};
                        return [
                          `Farmers: ${d.farmerCount ?? value}`,
                          d.label,
                        ];
                      }} content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const d = payload[0].payload;
                          return (
                            <div style={{ background: '#fff', padding: 8, border: '1px solid #ddd' }}>
                              <div><strong>{d.label}</strong></div>
                              <div>Farmers: {d.farmerCount}</div>
                              {showPieDetailMetrics && (
                                <>
                                  <div>Avg income: {d.avgIncome != null ? d.avgIncome : 'N/A'}</div>
                                  <div>Avg input usage: {d.avgInputUsage != null ? `${d.avgInputUsage}%` : 'N/A'}</div>
                                </>
                              )}
                            </div>
                          );
                        }
                        return null;
                      }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {hasRegionData && (
                <div style={{ flex: 1 }}>
                  <h3>Region Completion %</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart layout="vertical" data={regionData} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" domain={[0, 100]} unit="%" />
                      <YAxis dataKey="region" type="category" />
                      <Bar dataKey="completionPct" name="Completion %" label={{ position: 'right', formatter: (v) => `${v}%` }}>
                        {regionData.map((entry, i) => (
                          <Cell key={`r-${i}`} fill={entry.completionPct >= 75 ? '#2ecc71' : entry.completionPct >= 40 ? '#f39c12' : '#e74c3c'} />
                        ))}
                      </Bar>
                      <ReTooltip formatter={(v, n, props) => [`${v}%`, props?.payload?.region || '']} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          ) : (
            <EmptyState title="No chart data" message="No analytics chart data is available for the selected scope." />
          )
        )}

        {(hasInputCountData || hasIncomeData) && (
          <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem' }}>
            {hasInputCountData && (
              <div style={{ flex: 1 }}>
                <h4>Input Usage (Counts)</h4>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={inputCounts} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Legend />
                    <Bar dataKey="yes" fill="#2ecc71" name="Yes" />
                    <Bar dataKey="no" fill="#e74c3c" name="No" />
                    <ReTooltip />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {hasIncomeData && (
              <div style={{ flex: 1 }}>
                <h4>Avg Income: Yes vs No</h4>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={inputAvgIncome} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Legend />
                    <Bar dataKey="yes" fill="#3498db" name="Avg Income (Yes)" />
                    <Bar dataKey="no" fill="#f1c40f" name="Avg Income (No)" />
                    <ReTooltip />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
      </div>


      <div className="card">
        <h2>Input Usage</h2>
        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Response</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {seedUsage.map((item) => (
                <tr key={`seed-${item.response}`}>
                  <td data-label="Category">Improved Seeds (Q3)</td>
                  <td data-label="Response">{item.response}</td>
                  <td data-label="Count">{item.count}</td>
                </tr>
              ))}
              {fertilizerUsage.map((item) => (
                <tr key={`fert-${item.response}`}>
                  <td data-label="Category">Fertilizer Use (Q5)</td>
                  <td data-label="Response">{item.response}</td>
                  <td data-label="Count">{item.count}</td>
                </tr>
              ))}
              {seedUsage.length === 0 && fertilizerUsage.length === 0 && (
                <tr>
                  <td colSpan="3">No input usage data yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
