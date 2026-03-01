import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import SectionTitle from './ui/SectionTitle';

const DEFAULT_FILTER = {
    sourceSurveyId: 'survey1',
    sourceQuestionId: '',
    selectedOption: '',
};

const toErrorMessage = (error, fallback) => {
    const payload = error?.response?.data;
    return payload?.message || payload?.error?.message || payload?.error || error?.message || fallback;
};

export default function FarmersTargetingPanel() {
    const [surveys, setSurveys] = useState([]);
    const [questionsBySurvey, setQuestionsBySurvey] = useState({});
    const [filters, setFilters] = useState([DEFAULT_FILTER]);
    const [mode, setMode] = useState('all');
    const [limit, setLimit] = useState(500);
    const [targetSurveyId, setTargetSurveyId] = useState('survey1');

    const [filtering, setFiltering] = useState(false);
    const [sending, setSending] = useState(false);
    const [status, setStatus] = useState(null);
    const [matchedResult, setMatchedResult] = useState(null);

    const surveyOptions = useMemo(() => {
        if (surveys.length > 0) return surveys;
        return [{ id: 'survey1', name: 'survey1' }];
    }, [surveys]);

    useEffect(() => {
        let cancelled = false;

        const loadSurveys = async () => {
            try {
                const res = await axios.get('/api/survey/surveys');
                const docs = Array.isArray(res.data?.surveys) ? res.data.surveys : [];
                if (cancelled) return;

                setSurveys(docs);
                if (docs.length > 0) {
                    setTargetSurveyId((prev) => (docs.some((item) => item.id === prev) ? prev : docs[0].id));
                    setFilters((prev) => prev.map((item) => ({
                        ...item,
                        sourceSurveyId: docs.some((survey) => survey.id === item.sourceSurveyId)
                            ? item.sourceSurveyId
                            : docs[0].id,
                    })));
                }
            } catch {
                if (!cancelled) setSurveys([]);
            }
        };

        loadSurveys();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        let cancelled = false;
        const neededSurveyIds = Array.from(new Set(filters.map((item) => item.sourceSurveyId).filter(Boolean)));

        const loadQuestions = async () => {
            const nextState = {};

            for (const surveyId of neededSurveyIds) {
                try {
                    const res = await axios.get('/api/survey/questions', { params: { surveyId } });
                    nextState[surveyId] = Array.isArray(res.data?.questions) ? res.data.questions : [];
                } catch {
                    nextState[surveyId] = [];
                }
            }

            if (!cancelled) {
                setQuestionsBySurvey((prev) => ({ ...prev, ...nextState }));
            }
        };

        if (neededSurveyIds.length > 0) {
            loadQuestions();
        }

        return () => { cancelled = true; };
    }, [filters]);

    const updateFilter = (index, patch) => {
        setFilters((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
    };

    const addFilter = () => {
        const defaultSurveyId = surveyOptions[0]?.id || 'survey1';
        setFilters((prev) => [...prev, { ...DEFAULT_FILTER, sourceSurveyId: defaultSurveyId }]);
    };

    const removeFilter = (index) => {
        setFilters((prev) => {
            if (prev.length <= 1) return prev;
            return prev.filter((_, itemIndex) => itemIndex !== index);
        });
    };

    const normalizedFilters = useMemo(() => {
        return filters
            .map((item) => ({
                sourceSurveyId: item.sourceSurveyId,
                sourceQuestionId: String(item.sourceQuestionId || '').trim(),
                selectedOption: String(item.selectedOption || '').trim(),
            }))
            .filter((item) => item.sourceQuestionId)
            .map((item) => ({
                sourceSurveyId: item.sourceSurveyId,
                sourceQuestionId: item.sourceQuestionId,
                ...(item.selectedOption ? { selectedOption: item.selectedOption } : {}),
            }));
    }, [filters]);

    const runMultiFilter = async () => {
        setStatus(null);
        if (normalizedFilters.length === 0) {
            setStatus({ type: 'error', message: 'Add at least one filter condition with a question.' });
            return;
        }

        setFiltering(true);
        try {
            const res = await axios.post('/api/farmers/filter/query', {
                filters: normalizedFilters,
                mode,
                limit,
            });

            setMatchedResult(res.data || null);
            setStatus({
                type: 'success',
                message: `Filter complete. ${res.data?.totalMatched || 0} farmer(s) matched.`,
            });
        } catch (error) {
            setStatus({ type: 'error', message: toErrorMessage(error, 'Failed to run multi-level filter.') });
        } finally {
            setFiltering(false);
        }
    };

    const sendSurveyToMatched = async () => {
        setStatus(null);

        if (normalizedFilters.length === 0) {
            setStatus({ type: 'error', message: 'Add at least one filter condition with a question.' });
            return;
        }

        if (!targetSurveyId.trim()) {
            setStatus({ type: 'error', message: 'Choose target survey to send.' });
            return;
        }

        if (!matchedResult || Number(matchedResult.totalMatched || 0) <= 0) {
            setStatus({ type: 'error', message: 'Review matched farmers first by clicking "Preview Matched Farmers".' });
            return;
        }

        setSending(true);
        try {
            const res = await axios.post('/api/farmers/filter/send-survey', {
                filters: normalizedFilters,
                mode,
                limit,
                targetSurveyId: targetSurveyId.trim(),
                async: true,
            });

            const totalMatched = matchedResult?.totalMatched || res.data?.totalMatched || 0;
            setStatus({
                type: 'success',
                message: res.data?.message || `Survey send request submitted for ${totalMatched} matched farmers.`,
            });
        } catch (error) {
            setStatus({ type: 'error', message: toErrorMessage(error, 'Failed to send survey to filtered farmers.') });
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="card">
            <SectionTitle icon="targeting" title="Multi-Filter Targeting" />
            <p style={{ color: '#7f8c8d', marginBottom: '1rem' }}>
                Create multi-level filters to target and send surveys.
            </p>

            {status?.message && (
                <div className={status.type === 'error' ? 'error' : 'success'}>{status.message}</div>
            )}

            <div className="form-grid" style={{ gap: '0.75rem' }}>
                <label>Filter mode</label>
                <div className="invite-mode-toggle">
                    <button
                        type="button"
                        className={mode === 'all' ? 'active' : ''}
                        onClick={() => setMode('all')}
                    >
                        Match all conditions (AND)
                    </button>
                    <button
                        type="button"
                        className={mode === 'any' ? 'active' : ''}
                        onClick={() => setMode('any')}
                    >
                        Match any condition (OR)
                    </button>
                </div>

                {filters.map((filterItem, index) => {
                    const questions = questionsBySurvey[filterItem.sourceSurveyId] || [];
                    const selectedQuestion = questions.find((question) => question.id === filterItem.sourceQuestionId) || null;
                    const options = Array.isArray(selectedQuestion?.options) ? selectedQuestion.options : [];

                    return (
                        <div key={`filter-${index}`} style={{ border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.75rem' }}>
                            <strong style={{ display: 'block', marginBottom: '0.5rem' }}>Condition {index + 1}</strong>

                            <label>Source survey</label>
                            <select
                                value={filterItem.sourceSurveyId}
                                onChange={(event) => updateFilter(index, { sourceSurveyId: event.target.value, sourceQuestionId: '', selectedOption: '' })}
                            >
                                {surveyOptions.map((survey) => (
                                    <option key={survey.id} value={survey.id}>{survey.name || survey.id}</option>
                                ))}
                            </select>

                            <label>Question</label>
                            <select
                                value={filterItem.sourceQuestionId}
                                onChange={(event) => updateFilter(index, { sourceQuestionId: event.target.value, selectedOption: '' })}
                            >
                                <option value="">Select question</option>
                                {questions.map((question) => (
                                    <option key={question.id} value={question.id}>{question.id} — {question.text || ''}</option>
                                ))}
                            </select>

                            <label>Option (text)</label>
                            <select
                                value={filterItem.selectedOption}
                                onChange={(event) => updateFilter(index, { selectedOption: event.target.value })}
                                disabled={!selectedQuestion}
                            >
                                <option value="">Any option</option>
                                {options.map((option) => (
                                    <option key={String(option)} value={String(option)}>{String(option)}</option>
                                ))}
                            </select>

                            <div style={{ marginTop: '0.5rem' }}>
                                <button type="button" onClick={() => removeFilter(index)} disabled={filters.length <= 1}>Remove condition</button>
                            </div>
                        </div>
                    );
                })}

                <div>
                    <button type="button" onClick={addFilter}>+ Add condition</button>
                </div>

                <label>Result limit</label>
                <input
                    type="number"
                    min={1}
                    max={5000}
                    value={limit}
                    onChange={(event) => setLimit(Number(event.target.value) || 500)}
                />

                <div className="targeting-action-grid">
                    <div className="targeting-action-column">
                        <strong>Review Farmers</strong>
                        <p className="helper-note">Run filter and review matched farmers before sending.</p>
                        <button type="button" onClick={runMultiFilter} disabled={filtering}>
                            {filtering ? 'Filtering...' : 'Preview Matched Farmers'}
                        </button>
                        <span className="input-hint">
                            Matched: {Number(matchedResult?.totalMatched || 0)} farmer(s)
                        </span>
                    </div>

                    <div className="targeting-action-column">
                        <strong>Send Survey</strong>
                        <p className="helper-note">Choose survey and send to the reviewed farmer list.</p>
                        <select value={targetSurveyId} onChange={(event) => setTargetSurveyId(event.target.value)}>
                            {surveyOptions.map((survey) => (
                                <option key={survey.id} value={survey.id}>{survey.name || survey.id}</option>
                            ))}
                        </select>

                        <button
                            type="button"
                            onClick={sendSurveyToMatched}
                            disabled={sending || Number(matchedResult?.totalMatched || 0) <= 0}
                        >
                            {sending ? 'Sending...' : 'Send Target Survey'}
                        </button>
                    </div>
                </div>
            </div>

            {matchedResult && (
                <div style={{ marginTop: '1rem' }}>
                    <h3 style={{ marginBottom: '0.5rem' }}>Matched Farmers ({matchedResult.totalMatched || 0})</h3>
                    {Array.isArray(matchedResult.farmers) && matchedResult.farmers.length > 0 ? (
                        <div className="table-responsive">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Phone</th>
                                        <th>Language</th>
                                        <th>Region</th>
                                        <th>Matched Conditions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {matchedResult.farmers.map((farmer) => (
                                        <tr key={farmer.phoneNumber}>
                                            <td>{farmer.phoneNumber}</td>
                                            <td>{farmer.preferredLanguage || '-'}</td>
                                            <td>{farmer.region || '-'}</td>
                                            <td>{Array.isArray(farmer.matchedConditions) ? farmer.matchedConditions.length : 0}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="helper-note">No farmers matched the current multi-level filter.</p>
                    )}
                </div>
            )}
        </div>
    );
}
