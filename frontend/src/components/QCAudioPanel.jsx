import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import ErrorBanner from './ui/ErrorBanner';
import EmptyState from './ui/EmptyState';
import Skeleton, { Line } from './ui/Skeleton';

const API_BASE = 'http://localhost:3000';

export default function QCAudioPanel() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filters, setFilters] = useState({
        phoneNumber: '',
        sessionId: '',
        questionId: '',
    });
    const filtersRef = useRef(filters);

    useEffect(() => {
        filtersRef.current = filters;
    }, [filters]);

    const fetchAudio = useCallback(async (activeFilters = filtersRef.current) => {
        try {
            setLoading(true);
            const response = await axios.get(`${API_BASE}/api/qc/audio`, {
                params: {
                    phoneNumber: activeFilters.phoneNumber || undefined,
                    sessionId: activeFilters.sessionId || undefined,
                    questionId: activeFilters.questionId || undefined,
                },
            });
            setItems(response.data.items || []);
            setError(null);
        } catch {
            setError('Failed to load audio QC list. Backend may be offline.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAudio();
    }, [fetchAudio]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFilters((prev) => ({ ...prev, [name]: value }));
    };

    const handleFilter = (e) => {
        e.preventDefault();
        fetchAudio();
    };

    return (
        <div>
            <div className="card">
                <h2>QC Audio Review</h2>
                <p style={{ color: '#7f8c8d', marginBottom: '1rem' }}>
                    Review voice notes linked to survey answers. Confirm responses using numeric replies.
                </p>

                <form onSubmit={handleFilter} style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                    <div className="form-group">
                        <label htmlFor="phoneNumber">Farmer Phone</label>
                        <input
                            id="phoneNumber"
                            name="phoneNumber"
                            value={filters.phoneNumber}
                            onChange={handleChange}
                            placeholder="+919876543210"
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="sessionId">Session ID</label>
                        <input
                            id="sessionId"
                            name="sessionId"
                            value={filters.sessionId}
                            onChange={handleChange}
                            placeholder="session_..."
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="questionId">Question ID</label>
                        <input
                            id="questionId"
                            name="questionId"
                            value={filters.questionId}
                            onChange={handleChange}
                            placeholder="Q1"
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                        <button type="submit">Filter</button>
                    </div>
                </form>
            </div>

            <div className="card">
                <h2>Audio Responses</h2>
                <ErrorBanner message={error} onRetry={fetchAudio} />

                {loading ? (
                    <div>
                        {[1, 2, 3].map((i) => (
                            <div key={i} style={{ marginBottom: '0.75rem' }}>
                                <div className="card" style={{ padding: '0.75rem' }}>
                                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                        <div style={{ flex: '0 0 40px' }}><Line width="40px" /></div>
                                        <div style={{ flex: 1 }}>
                                            <Line width="60%" />
                                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                                <Line width="120px" />
                                                <Line width="90px" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="table-responsive">
                        <table>
                            <thead>
                                <tr>
                                    <th>Farmer Phone</th>
                                    <th>Region</th>
                                    <th>Question</th>
                                    <th>Recorded At</th>
                                    <th>Audio</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.length === 0 && (
                                    <tr>
                                        <td colSpan="5"><EmptyState title="No audio responses" message="There are no audio recordings matching your filters." actionLabel="Clear filters" onAction={() => setFilters({ phoneNumber: '', sessionId: '', questionId: '' })} /></td>
                                    </tr>
                                )}
                                {items.map((item) => (
                                    <tr key={item.audioId}>
                                        <td data-label="Farmer Phone"><strong>{item.farmerPhone}</strong></td>
                                        <td data-label="Region">{item.region}</td>
                                        <td data-label="Question">{item.questionId}: {item.questionText}</td>
                                        <td data-label="Recorded At">{item.createdAt || '-'}</td>
                                        <td data-label="Audio">
                                            <audio controls preload="none" style={{ width: '220px' }}>
                                                <source src={`${API_BASE}/api/qc/audio/${item.audioId}/file`} type={item.mimeType || 'audio/ogg'} />
                                                Your browser does not support the audio element.
                                            </audio>
                                            <div style={{ marginTop: 8 }}>
                                                <button onClick={async () => { await axios.post(`${API_BASE}/api/qc/audio/${item.audioId}/tag`, { status: 'approved' }); fetchAudio(); }}>Approve</button>
                                                <button onClick={async () => { await axios.post(`${API_BASE}/api/qc/audio/${item.audioId}/tag`, { status: 'rejected' }); fetchAudio(); }} style={{ marginLeft: 8 }}>Reject</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
