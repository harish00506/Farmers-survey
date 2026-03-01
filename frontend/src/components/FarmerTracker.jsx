import { useMemo, useRef, useState, useEffect } from 'react';
import axios from 'axios';
import SurveyInvitePanel from './SurveyInvitePanel';
import FarmersTargetingPanel from './FarmersTargetingPanel';
import ErrorBanner from './ui/ErrorBanner';
import EmptyState from './ui/EmptyState';
import { Line } from './ui/Skeleton';
import SectionTitle from './ui/SectionTitle';

export default function FarmerTracker() {
  const [farmers, setFarmers] = useState([]);
  const [selectedFarmer, setSelectedFarmer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingPhone, setDeletingPhone] = useState(null);
  const [error, setError] = useState(null);
  const [searchText, setSearchText] = useState('');
  const isFetchingRef = useRef(false);

  useEffect(() => {
    fetchFarmers({ silent: false });
    const interval = setInterval(() => fetchFarmers({ silent: true }), 5000); // silent refresh every 5s
    return () => clearInterval(interval);
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
      setFarmers(res.data.farmers || []);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch farmers', err);
      setError('Failed to load farmers. Is the backend running?');
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
      isFetchingRef.current = false;
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'completed':
        return <span className="badge badge-success">✓ Completed</span>;
      case 'in_progress':
        return <span className="badge badge-warning">⟳ In Progress</span>;
      default:
        return <span className="badge">{status}</span>;
    }
  };

  const handleView = async (farmer) => {
    try {
      const res = await axios.get(`/api/farmers/${encodeURIComponent(farmer.phone)}`);
      setSelectedFarmer(res.data.farmer || farmer);
    } catch (err) {
      console.error('Failed to fetch farmer details', err);
      // fallback to the provided farmer data
      setSelectedFarmer(farmer);
    }
  };

  const handleCloseDetails = () => {
    setSelectedFarmer(null);
  };

  const handleDelete = async (phone) => {
    const confirmed = window.confirm(`Delete phone number ${phone}? This will remove farmer, sessions, answers, and audio records.`);
    if (!confirmed) return;

    try {
      setDeletingPhone(phone);
      await axios.delete(`/api/farmers/${encodeURIComponent(phone)}`);
      setFarmers((prev) => prev.filter((farmer) => farmer.phone !== phone));
      if (selectedFarmer?.phone === phone) {
        setSelectedFarmer(null);
      }
      setError(null);
    } catch (err) {
      console.error('Failed to delete farmer', err);
      setError(`Failed to delete ${phone}. Please try again.`);
    } finally {
      setDeletingPhone(null);
      fetchFarmers({ silent: true });
    }
  };

  const filteredFarmers = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return farmers;

    return farmers.filter((farmer) => {
      const haystack = [
        farmer.phone,
        farmer.language,
        farmer.sessionStatus || farmer.status,
        farmer.surveyId,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');

      return haystack.includes(query);
    });
  }, [farmers, searchText]);

  const formatProgress = (farmer) => {
    const answered = Number(farmer?.questionsAnswered || 0);
    const total = Number(farmer?.totalQuestions || 0);
    if (total <= 0) return `${answered}/0 questions`;
    const pct = Math.min(100, Math.round((answered / total) * 100));
    return `${answered}/${total} questions (${pct}%)`;
  };

  return (
    <div>
      <SurveyInvitePanel />
      <FarmersTargetingPanel />
      <div className="card">
        <SectionTitle icon="users" title="Farmer Management" />
        <p style={{ color: '#7f8c8d', marginBottom: '1rem' }}>
          Track individual farmer participation and progress
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
          <input
            type="text"
            placeholder="Search by phone, language, status, survey..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            aria-label="Search farmers"
            style={{ marginBottom: 0 }}
          />
          <button
            type="button"
            onClick={() => fetchFarmers({ silent: true })}
            disabled={loading || refreshing}
            style={{ whiteSpace: 'nowrap' }}
          >
            {loading || refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className="table-responsive">
          <table className="farmer-table">
            <thead>
              <tr>
                <th>Phone</th>
                <th>Language</th>
                <th>Status</th>
                <th>Survey</th>
                <th>Progress</th>
                <th>Completed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={7}>
                  <ErrorBanner message={error} onRetry={() => fetchFarmers({ silent: false })} />
                </td>
              </tr>

              {loading ? (
                [1, 2, 3, 4].map((i) => (
                  <tr key={`sk-${i}`}>
                    <td><Line width="120px" /></td>
                    <td><Line width="80px" /></td>
                    <td><Line width="90px" /></td>
                    <td><Line width="90px" /></td>
                    <td><Line width="80px" /></td>
                    <td><Line width="100px" /></td>
                    <td><Line width="60px" /></td>
                  </tr>
                ))
              ) : filteredFarmers.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      title={farmers.length === 0 ? 'No farmers' : 'No matching farmers'}
                      message={farmers.length === 0 ? 'No farmers are on record. Seed the first surveys using the invite panel above.' : 'Try a different search term to find farmers.'}
                      actionLabel={farmers.length === 0 ? 'Seed invites' : 'Clear search'}
                      onAction={() => {
                        if (farmers.length === 0) {
                          document.querySelector('.invite-card')?.scrollIntoView({ behavior: 'smooth' });
                          return;
                        }
                        setSearchText('');
                      }}
                    />
                  </td>
                </tr>
              ) : (
                filteredFarmers.map((farmer) => (
                  <tr key={farmer.phone}>
                    <td data-label="Phone" className="no-wrap"><strong>{farmer.phone}</strong></td>
                    <td data-label="Language" className="no-wrap">{farmer.language}</td>
                    <td data-label="Status">{getStatusBadge(farmer.sessionStatus || farmer.status)}</td>
                    <td data-label="Survey" className="no-wrap">{farmer.surveyId || '-'}</td>
                    <td data-label="Progress" className="no-wrap">{formatProgress(farmer)}</td>
                    <td data-label="Completed" className="no-wrap">{farmer.completionDate ? new Date(farmer.completionDate).toLocaleString() : '-'}</td>
                    <td data-label="Actions" className="farmer-actions-cell">
                      <button
                        className="farmer-action-btn"
                        style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                        onClick={() => handleView(farmer)}
                        aria-label={`View details for ${farmer.phone}`}
                        disabled={loading || deletingPhone === farmer.phone}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        className="btn-danger farmer-action-btn"
                        style={{ marginLeft: '0.5rem', padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                        onClick={() => handleDelete(farmer.phone)}
                        aria-label={`Delete ${farmer.phone}`}
                        disabled={loading || deletingPhone === farmer.phone}
                      >
                        {deletingPhone === farmer.phone ? 'Deleting...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedFarmer && (
        <div className="card">
          <SectionTitle icon="users" title="Farmer Details" />
          <p><strong>Phone:</strong> {selectedFarmer.phone}</p>
          <p><strong>Language:</strong> {selectedFarmer.language}</p>
          <p><strong>Survey:</strong> {selectedFarmer.surveyId || selectedFarmer.session?.surveyId || '-'}</p>
          <p><strong>Status:</strong> {selectedFarmer.status || selectedFarmer.session?.status || '-'}</p>
          <p>
            <strong>Progress:</strong> {`${selectedFarmer.questionsAnswered ?? selectedFarmer.answers?.length ?? 0}/${selectedFarmer.totalQuestions ?? 0} questions`}
          </p>
          <p><strong>Started:</strong> {selectedFarmer.session?.startedAt ? new Date(selectedFarmer.session.startedAt).toLocaleString() : '-'}</p>
          <p><strong>Completed:</strong> {selectedFarmer.session?.completedAt ? new Date(selectedFarmer.session.completedAt).toLocaleString() : (selectedFarmer.completionDate || '-')}</p>

          {selectedFarmer.answers && selectedFarmer.answers.length > 0 && (
            <div style={{ marginTop: '0.5rem' }}>
              <h4>Answers</h4>
              <ul>
                {selectedFarmer.answers.map((a) => (
                  <li key={a.id || `${a.sessionId}-${a.questionId}`}>{a.questionId}: {a.selectedOption ?? a.selectedOptionIndex ?? JSON.stringify(a.answer ?? a.selectedOption)}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ marginTop: '0.5rem' }}>
            <button onClick={handleCloseDetails} style={{ padding: '0.4rem 0.8rem' }}>Close</button>
          </div>
        </div>
      )}

      <div className="card">
        <SectionTitle icon="quality" title="Quality Metrics" />
        <div className="card-grid">
          <div className="stat-box" style={{ background: 'linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%)' }}>
            <h3>{farmers.length}</h3>
            <p>Total Farmers Registered</p>
          </div>
          <div className="stat-box" style={{ background: 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)' }}>
            <h3>
              {(() => {
                const total = farmers.length || 0;
                if (total === 0) return '0%';
                const completed = farmers.filter((f) => (f.sessionStatus || f.status) === 'completed').length;
                return `${Math.round((completed / total) * 100)}%`;
              })()}
            </h3>
            <p>Response Quality</p>
          </div>
          <div className="stat-box" style={{ background: 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)' }}>
            <h3>{farmers.filter((f) => (f.status || f.sessionStatus) === 'dropped').length || 0}</h3>
            <p>Dropouts</p>
          </div>
        </div>
      </div>
    </div>
  );
}
