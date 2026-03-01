import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import QuestionList from './QuestionList';
import QuestionForm from './QuestionForm';
import FlowVisualizer from './FlowVisualizer';
import TransitionSimulator from './TransitionSimulator';
import TranslationEditor from './TranslationEditor';

const API_ROOT = import.meta.env.VITE_API_ROOT || 'http://localhost:3000';

export default function QuestionsEditor() {
  const [questions, setQuestions] = useState([]);
  const [surveys, setSurveys] = useState([]);
  const [selectedSurveyId, setSelectedSurveyId] = useState('');
  const [newSurveyId, setNewSurveyId] = useState('');
  const [newSurveyName, setNewSurveyName] = useState('');
  const [surveyStatus, setSurveyStatus] = useState(null);
  const [creatingSurvey, setCreatingSurvey] = useState(false);
  const [deletingSurveyId, setDeletingSurveyId] = useState('');
  const [showCreateSurveyModal, setShowCreateSurveyModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editingTranslations, setEditingTranslations] = useState(null);
  const [editorView, setEditorView] = useState('catalog');

  // close modal on ESC when editing
  useEffect(() => {
    if (!editing && !editingTranslations) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { setEditing(null); setEditingTranslations(null); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing, editingTranslations]);

  const loadSurveys = useCallback(async () => {
    try {
      const res = await axios.get(`${API_ROOT}/api/survey/surveys`);
      const docs = res.data?.surveys || [];
      setSurveys(docs);
      if (docs.length === 0) {
        setSelectedSurveyId('');
        setEditorView('catalog');
        return;
      }

      if (selectedSurveyId && !docs.some((item) => item.id === selectedSurveyId)) {
        setSelectedSurveyId('');
        setQuestions([]);
        setEditorView('catalog');
      }
    } catch {
      setSurveys([]);
      setSelectedSurveyId('');
      setEditorView('catalog');
    }
  }, [selectedSurveyId]);

  async function createSurvey() {
    const id = newSurveyId.trim();
    const name = newSurveyName.trim();
    setSurveyStatus(null);

    if (!id) {
      setSurveyStatus({ type: 'error', message: 'Survey ID is required.' });
      return;
    }

    setCreatingSurvey(true);
    try {
      await axios.post(`${API_ROOT}/api/survey/surveys`, { id, name: name || id });
      await loadSurveys();
      setSelectedSurveyId(id);
      setEditorView('editor');
      await loadQuestions(id);
      setNewSurveyId('');
      setNewSurveyName('');
      setSurveyStatus({ type: 'success', message: `Survey created: ${id}` });
      setShowCreateSurveyModal(false);
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Failed to create survey.';
      setSurveyStatus({ type: 'error', message: msg });
    } finally {
      setCreatingSurvey(false);
    }
  }

  async function deleteSurvey(surveyId) {
    if (!surveyId) return;
    if (!confirm(`Delete survey "${surveyId}" permanently? This will remove all questions, transitions, answers, and sessions for this survey. This cannot be undone.`)) return;

    setSurveyStatus(null);
    setDeletingSurveyId(surveyId);
    try {
      await axios.delete(`${API_ROOT}/api/survey/surveys/${encodeURIComponent(surveyId)}`);
      if (selectedSurveyId === surveyId) {
        setSelectedSurveyId('');
        setQuestions([]);
        setEditorView('catalog');
      }
      await loadSurveys();
      setSurveyStatus({ type: 'success', message: `Survey deleted: ${surveyId}` });
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Failed to delete survey.';
      setSurveyStatus({ type: 'error', message: msg });
    } finally {
      setDeletingSurveyId('');
    }
  }

  const openSurveyEditor = async (surveyId) => {
    if (!surveyId) return;
    setSelectedSurveyId(surveyId);
    setEditorView('editor');
    await loadQuestions(surveyId);
  };

  const loadQuestions = useCallback(async (surveyId) => {
    const targetSurveyId = surveyId || selectedSurveyId;
    setLoading(true);
    try {
      const res = await axios.get(`${API_ROOT}/api/survey/questions`, { params: { surveyId: targetSurveyId } });
      setQuestions(res.data.questions || []);
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [selectedSurveyId]);

  useEffect(() => {
    loadSurveys();
  }, [loadSurveys]);

  useEffect(() => {
    if (editorView !== 'editor' || !selectedSurveyId) return;
    loadQuestions(selectedSurveyId);
  }, [selectedSurveyId, loadQuestions, editorView]);

  const onCreate = async (payload) => {
    try {
      await axios.post(`${API_ROOT}/api/survey/questions`, { ...payload, surveyId: selectedSurveyId });
      loadQuestions(selectedSurveyId);
      setEditing(null);
    } catch (err) {
      const serverMsg = err?.response?.data?.error?.message || err?.response?.data?.error || err?.response?.data || err.message;
      console.error('Create question failed:', err?.response?.data || err);
      alert('Failed to create question: ' + (serverMsg || 'Unknown error'));
    }
  };

  const onUpdate = async (id, payload) => {
    try {
      await axios.put(`${API_ROOT}/api/survey/questions/${id}`, { ...payload, surveyId: selectedSurveyId }, { params: { surveyId: selectedSurveyId } });
      loadQuestions(selectedSurveyId);
      setEditing(null);
    } catch (err) {
      const serverMsg = err?.response?.data?.error?.message || err?.response?.data?.error || err?.response?.data || err.message;
      console.error('Update question failed:', err?.response?.data || err);
      alert('Failed to update question: ' + (serverMsg || 'Unknown error'));
    }
  };

  const onDelete = async (id) => {
    if (!confirm('Delete question permanently? This will remove the question from the database and delete transitions pointing to it. This cannot be undone. Continue?')) return;
    try {
      await axios.delete(`${API_ROOT}/api/survey/questions/${id}`, { params: { surveyId: selectedSurveyId } });
      loadQuestions(selectedSurveyId);
    } catch (err) {
      alert('Failed to delete question: ' + err.message);
    }
  };

  const onReorder = async (orderedIds = []) => {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0 || !selectedSurveyId) return;

    const byId = new Map((questions || []).map((q) => [q.id, q]));
    const reordered = orderedIds
      .map((id, index) => {
        const question = byId.get(id);
        if (!question) return null;
        return { ...question, sequence: index };
      })
      .filter(Boolean);

    if (reordered.length !== questions.length) return;

    setQuestions(reordered);

    try {
      await axios.post(`${API_ROOT}/api/survey/questions/resequence`, {
        orderedIds,
        surveyId: selectedSurveyId,
      });
      await loadQuestions(selectedSurveyId);
    } catch (err) {
      await loadQuestions(selectedSurveyId);
      const serverMsg = err?.response?.data?.error || err.message || 'Failed to save question order.';
      alert(`Failed to reorder questions: ${serverMsg}`);
    }
  };

  const [ttsStatus, setTtsStatus] = useState(null);

  const onPlayTTS = async (question) => {
    setTtsStatus('Generating TTS...');
    try {
      const payload = { text: question.text };
      if (question.language) payload.language = question.language;
      const res = await axios.post(`${API_ROOT}/api/tts/synthesize`, payload);
      const { fileUrl } = res.data;
      // Play the returned audio file
      const audio = new Audio(`${API_ROOT}${fileUrl}`);
      await audio.play();
      setTtsStatus('Playing TTS');
      audio.onended = () => setTtsStatus(null);
    } catch (err) {
      console.error('TTS failed', err);
      setTtsStatus('TTS failed');
      setTimeout(() => setTtsStatus(null), 3000);
    }
  };

  const [showFlow, setShowFlow] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [flowHasUnsavedChanges, setFlowHasUnsavedChanges] = useState(false);

  const requestCloseFlow = () => {
    if (flowHasUnsavedChanges) {
      const shouldClose = confirm('You have unsaved flow changes. Close without saving?');
      if (!shouldClose) return;
    }
    setShowFlow(false);
    setFlowHasUnsavedChanges(false);
  };

  const selectedSurvey = surveys.find((survey) => survey.id === selectedSurveyId) || null;

  return (
    <div>
      <h2>Survey Editor</h2>
      <div style={{ marginBottom: 12 }}>
        {editorView === 'catalog' ? (
          <>
            <button onClick={() => setShowCreateSurveyModal(true)}>
              Create Survey
            </button>
            <span style={{ marginLeft: 10, color: '#6b7280' }}>Select a survey below to open question editor.</span>
          </>
        ) : (
          <>
            <button onClick={() => { setEditorView('catalog'); setEditing(null); }}>
              ← Back to Surveys
            </button>
            <span style={{ marginLeft: 10, fontWeight: 600 }}>{selectedSurvey?.name || selectedSurveyId}</span>
            <button onClick={() => setEditing({})} style={{ marginLeft: 8 }}>+ Add Question</button>
            <button onClick={() => loadQuestions(selectedSurveyId)} style={{ marginLeft: 8 }}>Refresh</button>
            <button onClick={() => { setFlowHasUnsavedChanges(false); setShowFlow(true); }} style={{ marginLeft: 8 }}>Preview Flow</button>
            <button onClick={() => setShowSimulator(true)} style={{ marginLeft: 8 }}>Simulator</button>
            <button
              onClick={() => deleteSurvey(selectedSurveyId)}
              className="btn-danger"
              style={{ marginLeft: 8 }}
              disabled={!selectedSurveyId || deletingSurveyId === selectedSurveyId || selectedSurveyId === 'survey1'}
              title={selectedSurveyId === 'survey1' ? 'Default survey cannot be deleted' : 'Delete this survey'}
            >
              {deletingSurveyId === selectedSurveyId ? 'Deleting…' : 'Delete Survey'}
            </button>
          </>
        )}
      </div>

      {editorView === 'catalog' && (
        <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
          {surveys.length === 0 && (
            <div className="status">No surveys found. Create your first survey.</div>
          )}

          {surveys.map((survey) => (
            <div key={survey.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{survey.name || survey.id}</div>
                <small style={{ color: '#6b7280' }}>ID: {survey.id}</small>
              </div>
              <div>
                <button onClick={() => openSurveyEditor(survey.id)}>Open</button>
                <button
                  onClick={() => deleteSurvey(survey.id)}
                  className="btn-danger"
                  style={{ marginLeft: 8 }}
                  disabled={deletingSurveyId === survey.id || survey.id === 'survey1'}
                  title={survey.id === 'survey1' ? 'Default survey cannot be deleted' : 'Delete survey'}
                >
                  {deletingSurveyId === survey.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateSurveyModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreateSurveyModal(false); }}
          role="dialog"
          aria-modal="true"
        >
          <div style={{ background: '#fff', padding: 20, borderRadius: 8, minWidth: 520, boxShadow: '0 10px 30px rgba(0,0,0,0.3)', position: 'relative' }}>
            <button
              onClick={() => setShowCreateSurveyModal(false)}
              aria-label="Close"
              style={{ position: 'absolute', top: 8, right: 8 }}
            >
              ×
            </button>
            <h3 style={{ marginTop: 0 }}>Create Survey</h3>
            <div style={{ display: 'grid', gap: 10 }}>
              <input
                placeholder="new survey id (e.g. survey2)"
                value={newSurveyId}
                onChange={(e) => setNewSurveyId(e.target.value)}
              />
              <input
                placeholder="new survey name"
                value={newSurveyName}
                onChange={(e) => setNewSurveyName(e.target.value)}
              />
            </div>
            <div style={{ marginTop: 12 }}>
              <button onClick={createSurvey} disabled={creatingSurvey}>
                {creatingSurvey ? 'Creating…' : 'Create Survey'}
              </button>
              <button onClick={() => setShowCreateSurveyModal(false)} style={{ marginLeft: 8 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {surveyStatus && (
        <div className={surveyStatus.type === 'error' ? 'error' : 'status'} style={{ marginBottom: 12 }}>
          {surveyStatus.message}
        </div>
      )}

      {ttsStatus && <div className="status">{ttsStatus}</div>}

      {editorView === 'editor' && editing && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}
          role="dialog"
          aria-modal="true"
        >
          <div style={{ background: '#fff', padding: 20, borderRadius: 8, minWidth: 640, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', position: 'relative' }}>
            <button onClick={() => setEditing(null)} aria-label="Close" style={{ position: 'absolute', top: 8, right: 8 }}>×</button>
            <h3 style={{ marginTop: 0 }}>{editing.id ? 'Edit Question' : 'Add Question'}</h3>
            <QuestionForm key={editing?.id || 'new-question'} question={editing} questions={questions} surveyId={selectedSurveyId} onSave={(payload) => (editing.id ? onUpdate(editing.id, payload) : onCreate(payload))} onCancel={() => setEditing(null)} />
          </div>
        </div>
      )}

      {editorView === 'editor' && showFlow && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) requestCloseFlow(); }}
          role="dialog"
          aria-modal="true"
        >
          <div style={{ background: '#fff', padding: 20, borderRadius: 8, minWidth: 900, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', position: 'relative' }}>
            <button onClick={requestCloseFlow} aria-label="Close" style={{ position: 'absolute', top: 8, right: 8 }}>×</button>
            <h3 style={{ marginTop: 0 }}>Survey Flow Preview</h3>
            <FlowVisualizer
              questions={questions}
              surveyId={selectedSurveyId}
              onDirtyChange={setFlowHasUnsavedChanges}
              onRequestClose={requestCloseFlow}
            />
          </div>
        </div>
      )}

      {editorView === 'editor' && showSimulator && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowSimulator(false); }}
          role="dialog"
          aria-modal="true"
        >
          <div style={{ background: '#fff', padding: 20, borderRadius: 8, minWidth: 900, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', position: 'relative' }}>
            <button onClick={() => setShowSimulator(false)} aria-label="Close" style={{ position: 'absolute', top: 8, right: 8 }}>×</button>
            <h3 style={{ marginTop: 0 }}>Survey Simulator</h3>
            <TransitionSimulator questions={questions} />
          </div>
        </div>
      )}

      {editorView === 'editor' && editingTranslations && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditingTranslations(null); }}
          role="dialog"
          aria-modal="true"
        >
          <div style={{ background: '#fff', padding: 20, borderRadius: 8, minWidth: 740, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', position: 'relative' }}>
            <button onClick={() => setEditingTranslations(null)} aria-label="Close" style={{ position: 'absolute', top: 8, right: 8 }}>×</button>
            <h3 style={{ marginTop: 0 }}>Edit Translations — {editingTranslations.id}</h3>
            <TranslationEditor
              question={editingTranslations}
              surveyId={selectedSurveyId}
              onClose={() => setEditingTranslations(null)}
              onSaved={() => { loadQuestions(selectedSurveyId); }}
            />
          </div>
        </div>
      )}
      {editorView === 'editor' && loading && <div>Loading…</div>}
      {editorView === 'editor' && error && <div className="error">{error}</div>}
      {editorView === 'editor' && (
        <QuestionList
          questions={questions}
          onEdit={(q) => setEditing(q)}
          onDelete={onDelete}
          onRefresh={loadQuestions}
          onPlayTTS={onPlayTTS}
          onReorder={onReorder}
          onEditTranslations={(q) => setEditingTranslations(q)}
        />
      )}
    </div>
  );
}
