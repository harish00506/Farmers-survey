import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ErrorBanner from './ui/ErrorBanner';
import EmptyState from './ui/EmptyState';
import Skeleton, { Block, Line } from './ui/Skeleton';

export default function SurveyMonitor() {
  const [surveyScope, setSurveyScope] = useState('all');
  const [surveys, setSurveys] = useState([]);
  const [stats, setStats] = useState({
    totalFarmers: 0,
    completedSessions: 0,
    inProgressSessions: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [activityError, setActivityError] = useState(null);

  useEffect(() => {
    const fetchSurveys = async () => {
      try {
        const response = await axios.get('http://localhost:3000/api/survey/surveys');
        setSurveys(response.data?.surveys || []);
      } catch {
        setSurveys([]);
      }
    };

    fetchSurveys();
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const response = await axios.get('http://localhost:3000/api/analytics/summary', { params: { surveyId: surveyScope } });
      setStats(response.data.summary || { totalFarmers: 0, completedSessions: 0, inProgressSessions: 0 });
      setError(null);
    } catch (error) {
      setError('Failed to fetch survey data. Backend may be offline.');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [surveyScope]);

  const fetchRecentActivity = useCallback(async () => {
    try {
      const response = await axios.get('http://localhost:3000/api/analytics/recent', { params: { limit: 10, surveyId: surveyScope } });
      const list = response.data.recent || [];

      // Deduplicate entries (by farmerPhone, questionId, respondedAt, answer)
      const seen = new Set();
      const unique = list.filter((item) => {
        const key = `${item.farmerPhone}|${item.questionId}|${item.respondedAt}|${item.answer}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Sort by respondedAt desc (newest first)
      unique.sort((a, b) => new Date(b.respondedAt) - new Date(a.respondedAt));

      // Only show the top N recent activities in the UI
      const TOP_N = 5;
      const top = unique.slice(0, TOP_N);
      setRecentActivity(top);
      setActivityError(null);
    } catch (error) {
      setActivityError('Failed to fetch recent activity. Backend may be offline.');
      console.error(error);
    }
  }, [surveyScope]);

  useEffect(() => {
    fetchStats();
    fetchRecentActivity();
    const interval = setInterval(() => {
      fetchStats();
      fetchRecentActivity();
    }, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, [fetchRecentActivity, fetchStats]);



  return (
    <div>
      <div className="card">
        <h2>📊 Live Survey Status</h2>
        <ErrorBanner message={error} onRetry={fetchStats} />
        <div style={{ marginBottom: '1rem' }}>
          <select value={surveyScope} onChange={(e) => setSurveyScope(e.target.value)}>
            <option value="all">All Surveys</option>
            {surveys.map((survey) => (
              <option key={survey.id} value={survey.id}>{survey.name || survey.id}</option>
            ))}
          </select>
        </div>

        <div className="card-grid">
          {loading ? (
            // show simple skeleton stat boxes while loading
            [1, 2, 3].map((i) => (
              <div key={i} className="stat-box" style={{ minHeight: 84 }}>
                <Block />
              </div>
            ))
          ) : (
            <>
              <div className="stat-box">
                <h3>{stats.totalFarmers}</h3>
                <p>Total Farmers</p>
              </div>
              <div className="stat-box" style={{ background: 'linear-gradient(135deg, #2ecc71 0%, #27ae60 100%)' }}>
                <h3>{stats.completedSessions}</h3>
                <p>Completed Surveys</p>
              </div>
              <div className="stat-box" style={{ background: 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)' }}>
                <h3>{stats.inProgressSessions}</h3>
                <p>In Progress</p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2>📝 Recent Activity</h2>
        <p style={{ color: '#7f8c8d', marginBottom: '1rem' }}>
          Showing top 5 recent survey responses (live)
        </p>
        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Farmer Phone</th>
                <th>Question</th>
                <th>Answer</th>
                <th>Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5}>
                  <ErrorBanner message={activityError} onRetry={fetchRecentActivity} />
                </td>
              </tr>

              {loading ? (
                // three skeleton rows
                [1, 2, 3].map((i) => (
                  <tr key={`sk-${i}`}>
                    <td><Line width="140px" /></td>
                    <td><Line width="180px" /></td>
                    <td><Line width="120px" /></td>
                    <td><Line width="100px" /></td>
                    <td><Line width="80px" /></td>
                  </tr>
                ))
              ) : (
                !recentActivity || recentActivity.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState title="No recent activity" message="No recent survey responses were found in the last fetch window." />
                    </td>
                  </tr>
                ) : (
                  recentActivity.map((item, idx) => (
                    <tr key={`${item.farmerPhone}-${idx}`}>
                      <td data-label="Farmer Phone"><strong>{item.farmerPhone}</strong></td>
                      <td data-label="Question">{item.questionText || item.questionId}</td>
                      <td data-label="Answer">{item.answer}</td>
                      <td data-label="Time">{item.respondedAt}</td>
                      <td data-label="Status">
                        {item.sessionStatus === 'completed' && (
                          <span className="badge badge-success">Recorded</span>
                        )}
                        {item.sessionStatus === 'in_progress' && (
                          <span className="badge badge-warning">In Progress</span>
                        )}
                        {!['completed', 'in_progress'].includes(item.sessionStatus) && (
                          <span className="badge">{item.sessionStatus || '-'}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
