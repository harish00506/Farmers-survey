import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import ErrorBanner from './ui/ErrorBanner';
import EmptyState from './ui/EmptyState';
import { Line } from './ui/Skeleton';
import SectionTitle from './ui/SectionTitle';

export default function FarmersDatabaseTab() {
    const [farmers, setFarmers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(null);
    const isFetchingRef = useRef(false);

    const [searchText, setSearchText] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [surveyFilter, setSurveyFilter] = useState('all');
    const [languageFilter, setLanguageFilter] = useState('all');
    const [sortBy, setSortBy] = useState('phone');
    const [sortOrder, setSortOrder] = useState('asc');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);

    useEffect(() => {
        fetchFarmers({ silent: false });
    }, []);

    const fetchFarmers = async ({ silent = false } = {}) => {
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;

        try {
            if (silent) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            const res = await axios.get('/api/farmers');
            setFarmers(Array.isArray(res.data?.farmers) ? res.data.farmers : []);
            setError(null);
        } catch {
            setError('Failed to load farmer database.');
        } finally {
            setLoading(false);
            setRefreshing(false);
            isFetchingRef.current = false;
        }
    };

    const surveyOptions = useMemo(() => {
        const set = new Set((farmers || []).map((item) => String(item.surveyId || '').trim()).filter(Boolean));
        return ['all', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
    }, [farmers]);

    const languageOptions = useMemo(() => {
        const set = new Set((farmers || []).map((item) => String(item.language || '').trim()).filter(Boolean));
        return ['all', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
    }, [farmers]);

    const filteredFarmers = useMemo(() => {
        const query = searchText.trim().toLowerCase();

        return farmers.filter((farmer) => {
            const currentStatus = String(farmer.sessionStatus || farmer.status || '').trim();
            const currentSurvey = String(farmer.surveyId || '').trim();
            const currentLanguage = String(farmer.language || '').trim();

            if (statusFilter !== 'all' && currentStatus !== statusFilter) return false;
            if (surveyFilter !== 'all' && currentSurvey !== surveyFilter) return false;
            if (languageFilter !== 'all' && currentLanguage !== languageFilter) return false;

            if (!query) return true;

            const haystack = [
                farmer.phone,
                farmer.language,
                farmer.region,
                currentStatus,
                currentSurvey,
            ]
                .map((item) => String(item || '').toLowerCase())
                .join(' ');

            return haystack.includes(query);
        });
    }, [farmers, searchText, statusFilter, surveyFilter, languageFilter]);

    const sortedFarmers = useMemo(() => {
        const valueForSort = (farmer, key) => {
            if (key === 'status') return String(farmer.sessionStatus || farmer.status || '').trim();
            if (key === 'completionDate') return farmer.completionDate ? new Date(farmer.completionDate).getTime() : 0;
            if (key === 'questionsAnswered' || key === 'totalQuestions') return Number(farmer[key] || 0);
            return String(farmer[key] || '').trim();
        };

        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        const direction = sortOrder === 'asc' ? 1 : -1;

        return [...filteredFarmers].sort((a, b) => {
            const first = valueForSort(a, sortBy);
            const second = valueForSort(b, sortBy);

            if (typeof first === 'number' && typeof second === 'number') {
                return (first - second) * direction;
            }

            return collator.compare(String(first), String(second)) * direction;
        });
    }, [filteredFarmers, sortBy, sortOrder]);

    const totalPages = Math.max(1, Math.ceil(sortedFarmers.length / pageSize));
    const currentPage = Math.min(page, totalPages);
    const hasActiveFilters =
        searchText.trim() !== '' ||
        statusFilter !== 'all' ||
        surveyFilter !== 'all' ||
        languageFilter !== 'all';

    const statusStats = useMemo(() => {
        return farmers.reduce(
            (acc, farmer) => {
                const value = String(farmer.sessionStatus || farmer.status || '').trim() || 'unknown';
                acc[value] = (acc[value] || 0) + 1;
                return acc;
            },
            { in_progress: 0, completed: 0, dropped: 0, unknown: 0 }
        );
    }, [farmers]);

    const paginatedFarmers = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return sortedFarmers.slice(start, start + pageSize);
    }, [sortedFarmers, currentPage, pageSize]);

    useEffect(() => {
        setPage(1);
    }, [searchText, statusFilter, surveyFilter, languageFilter, sortBy, sortOrder, pageSize]);

    const handleSort = (key) => {
        if (sortBy === key) {
            setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
            return;
        }
        setSortBy(key);
        setSortOrder('asc');
    };

    const sortLabel = (key, label) => {
        if (sortBy !== key) return label;
        return `${label} ${sortOrder === 'asc' ? '↑' : '↓'}`;
    };

    const resetFilters = () => {
        setSearchText('');
        setStatusFilter('all');
        setSurveyFilter('all');
        setLanguageFilter('all');
    };

    const badgeClassForStatus = (statusValue) => {
        const status = String(statusValue || '').trim();
        if (status === 'completed') return 'badge badge-success';
        if (status === 'in_progress') return 'badge badge-info';
        if (status === 'dropped') return 'badge badge-warning';
        return 'badge';
    };

    const formatCompletionDate = (value) => {
        if (!value) return '-';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return '-';
        return parsed.toLocaleString();
    };

    return (
        <div className="card farmers-db-card">
            <div className="farmers-db-top">
                <div>
                    <SectionTitle icon="database" title="Farmer Database" />
                    <p className="farmers-db-subtitle">
                        Search, sort, and review farmer progress in one place.
                    </p>
                </div>

                <div className="farmers-db-kpis">
                    <div className="farmers-db-kpi">
                        <span>Total</span>
                        <strong>{farmers.length}</strong>
                    </div>
                    <div className="farmers-db-kpi">
                        <span>Completed</span>
                        <strong>{statusStats.completed || 0}</strong>
                    </div>
                    <div className="farmers-db-kpi">
                        <span>In Progress</span>
                        <strong>{statusStats.in_progress || 0}</strong>
                    </div>
                </div>
            </div>

            <div className="farmers-db-filters">
                <input
                    type="text"
                    placeholder="Search phone, region, language, survey..."
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                />

                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="all">All Status</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="dropped">Dropped</option>
                </select>

                <select value={surveyFilter} onChange={(event) => setSurveyFilter(event.target.value)}>
                    {surveyOptions.map((surveyId) => (
                        <option key={surveyId} value={surveyId}>{surveyId === 'all' ? 'All Surveys' : surveyId}</option>
                    ))}
                </select>

                <select value={languageFilter} onChange={(event) => setLanguageFilter(event.target.value)}>
                    {languageOptions.map((lang) => (
                        <option key={lang} value={lang}>{lang === 'all' ? 'All Languages' : lang}</option>
                    ))}
                </select>

                <button type="button" className="farmers-db-refresh" onClick={() => fetchFarmers({ silent: true })} disabled={loading || refreshing}>
                    {loading || refreshing ? 'Refreshing...' : 'Refresh'}
                </button>

                {hasActiveFilters && (
                    <button type="button" className="farmers-db-clear" onClick={resetFilters}>
                        Clear
                    </button>
                )}
            </div>

            <div className="farmers-db-meta">
                <span className="farmers-db-count">
                    Showing {sortedFarmers.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
                    {' - '}
                    {Math.min(currentPage * pageSize, sortedFarmers.length)} of {sortedFarmers.length}
                </span>

                <label className="farmers-db-page-size">
                    Rows per page
                    <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                    </select>
                </label>
            </div>

            <div className="table-responsive farmers-db-table-wrap">
                <table className="farmer-table">
                    <thead>
                        <tr>
                            <th>
                                <button type="button" className="farmers-db-sort-btn" onClick={() => handleSort('phone')}>
                                    {sortLabel('phone', 'Phone')}
                                </button>
                            </th>
                            <th>
                                <button type="button" className="farmers-db-sort-btn" onClick={() => handleSort('language')}>
                                    {sortLabel('language', 'Language')}
                                </button>
                            </th>
                            <th>
                                <button type="button" className="farmers-db-sort-btn" onClick={() => handleSort('region')}>
                                    {sortLabel('region', 'Region')}
                                </button>
                            </th>
                            <th>
                                <button type="button" className="farmers-db-sort-btn" onClick={() => handleSort('status')}>
                                    {sortLabel('status', 'Status')}
                                </button>
                            </th>
                            <th>
                                <button type="button" className="farmers-db-sort-btn" onClick={() => handleSort('surveyId')}>
                                    {sortLabel('surveyId', 'Survey')}
                                </button>
                            </th>
                            <th>
                                <button type="button" className="farmers-db-sort-btn" onClick={() => handleSort('questionsAnswered')}>
                                    {sortLabel('questionsAnswered', 'Questions Answered')}
                                </button>
                            </th>
                            <th>
                                <button type="button" className="farmers-db-sort-btn" onClick={() => handleSort('totalQuestions')}>
                                    {sortLabel('totalQuestions', 'Total Questions')}
                                </button>
                            </th>
                            <th>
                                <button type="button" className="farmers-db-sort-btn" onClick={() => handleSort('completionDate')}>
                                    {sortLabel('completionDate', 'Completed At')}
                                </button>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td colSpan={8}>
                                <ErrorBanner message={error} onRetry={() => fetchFarmers({ silent: false })} />
                            </td>
                        </tr>

                        {loading ? (
                            [1, 2, 3, 4, 5].map((rowId) => (
                                <tr key={`db-sk-${rowId}`}>
                                    <td><Line width="130px" /></td>
                                    <td><Line width="90px" /></td>
                                    <td><Line width="90px" /></td>
                                    <td><Line width="100px" /></td>
                                    <td><Line width="90px" /></td>
                                    <td><Line width="80px" /></td>
                                    <td><Line width="80px" /></td>
                                    <td><Line width="140px" /></td>
                                </tr>
                            ))
                        ) : sortedFarmers.length === 0 ? (
                            <tr>
                                <td colSpan={8}>
                                    <EmptyState
                                        title="No farmers found"
                                        message="No farmers match current filters."
                                        actionLabel="Reset filters"
                                        onAction={resetFilters}
                                    />
                                </td>
                            </tr>
                        ) : (
                            paginatedFarmers.map((farmer) => (
                                <tr key={farmer.phone}>
                                    <td className="no-wrap" data-label="Phone"><strong>{farmer.phone}</strong></td>
                                    <td className="no-wrap" data-label="Language">{farmer.language || '-'}</td>
                                    <td className="no-wrap" data-label="Region">{farmer.region || '-'}</td>
                                    <td className="no-wrap" data-label="Status">
                                        <span className={badgeClassForStatus(farmer.sessionStatus || farmer.status)}>
                                            {farmer.sessionStatus || farmer.status || '-'}
                                        </span>
                                    </td>
                                    <td className="no-wrap" data-label="Survey">{farmer.surveyId || '-'}</td>
                                    <td className="no-wrap" data-label="Questions Answered">{Number(farmer.questionsAnswered || 0)}</td>
                                    <td className="no-wrap" data-label="Total Questions">{Number(farmer.totalQuestions || 0)}</td>
                                    <td className="no-wrap" data-label="Completed At">{formatCompletionDate(farmer.completionDate)}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {!loading && sortedFarmers.length > 0 && (
                <div className="farmers-db-pagination">
                    <button type="button" className="farmers-db-page-btn" onClick={() => setPage(1)} disabled={currentPage === 1}>
                        First
                    </button>
                    <button type="button" className="farmers-db-page-btn" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1}>
                        Prev
                    </button>
                    <span className="farmers-db-page-indicator">Page {currentPage} / {totalPages}</span>
                    <button
                        type="button"
                        className="farmers-db-page-btn"
                        onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                        disabled={currentPage >= totalPages}
                    >
                        Next
                    </button>
                    <button type="button" className="farmers-db-page-btn" onClick={() => setPage(totalPages)} disabled={currentPage >= totalPages}>
                        Last
                    </button>
                </div>
            )}
        </div>
    );
}
