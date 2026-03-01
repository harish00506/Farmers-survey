import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ErrorBanner from './ui/ErrorBanner';
import EmptyState from './ui/EmptyState';
import { Block, Line } from './ui/Skeleton';
import SectionTitle from './ui/SectionTitle';

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
                const response = await axios.get('/api/survey/surveys');
                setSurveys(response.data?.surveys || []);
            } catch {
                setSurveys([]);
            }
        };

        fetchSurveys();
    }, []);

    const fetchStats = useCallback(async () => {
        try {
            const response = await axios.get('/api/analytics/summary', { params: { surveyId: surveyScope } });
            setStats(response.data.summary || { totalFarmers: 0, completedSessions: 0, inProgressSessions: 0 });
            setError(null);
        } catch (fetchError) {
            setError('Failed to fetch survey data. Backend may be offline.');
            console.error(fetchError);
        } finally {
            setLoading(false);
        }
    }, [surveyScope]);

    const fetchRecentActivity = useCallback(async () => {
        try {
            const response = await axios.get('/api/analytics/recent', { params: { limit: 10, surveyId: surveyScope } });
            const list = response.data.recent || [];

            const seen = new Set();
            const unique = list.filter((item) => {
                const key = `${item.farmerPhone}|${item.questionId}|${item.respondedAt}|${item.answer}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            unique.sort((a, b) => new Date(b.respondedAt) - new Date(a.respondedAt));
            setRecentActivity(unique.slice(0, 5));
            setActivityError(null);
        } catch (fetchError) {
            setActivityError('Failed to fetch recent activity. Backend may be offline.');
            console.error(fetchError);
        }
    }, [surveyScope]);

    useEffect(() => {
        fetchStats();
        fetchRecentActivity();
        const interval = setInterval(() => {
            fetchStats();
            fetchRecentActivity();
        }, 5000);
        return () => clearInterval(interval);
    }, [fetchRecentActivity, fetchStats]);

    return (
        <div className="survey-monitor-page">
            <div className="card survey-status-card">
                <SectionTitle icon="status" title="Live Survey Status" />
                <ErrorBanner message={error} onRetry={fetchStats} />

                <div className="survey-status-toolbar">
                    <label htmlFor="surveyScope" className="survey-status-filter-label">Survey scope</label>
                    <select id="surveyScope" value={surveyScope} onChange={(e) => setSurveyScope(e.target.value)}>
                        <option value="all">All Surveys</option>
                        {surveys.map((survey) => (
                            <option key={survey.id} value={survey.id}>{survey.name || survey.id}</option>
                        ))}
                    </select>
                </div>

                <div className="survey-status-grid">
                    {loading ? (
                        [1, 2, 3].map((i) => (
                            <div key={i} className="survey-status-metric survey-status-metric-skeleton">
                                <Block />
                            </div>
                        ))
                    ) : (
                        <>
                            <div className="survey-status-metric metric-total">
                                <p>Total Farmers</p>
                                <h3>{stats.totalFarmers}</h3>
                            </div>
                            <div className="survey-status-metric metric-completed">
                                <p>Completed Surveys</p>
                                <h3>{stats.completedSessions}</h3>
                            </div>
                            <div className="survey-status-metric metric-progress">
                                <p>In Progress</p>
                                <h3>{stats.inProgressSessions}</h3>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <div className="card survey-activity-card">
                <SectionTitle icon="activity" title="Recent Activity" />
                <p className="survey-activity-subtitle">
                    Showing top 5 recent survey responses (live)
                </p>

                <div className="table-responsive survey-activity-table-wrap">
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
