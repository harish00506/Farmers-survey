import { useState } from 'react';

export default function QuestionForm({ question = {}, questions = [], onSave = () => { }, onCancel = () => { } }) {
  const nextSequence = Array.isArray(questions) && questions.length > 0
    ? Math.max(...questions.map((q) => Number.isFinite(Number(q.sequence)) ? Number(q.sequence) : 0)) + 1
    : 0;

  const [id, setId] = useState(question.id || '');
  const [sequence, setSequence] = useState(question.sequence ?? nextSequence);
  const [text, setText] = useState(question.text || '');
  const [type, setType] = useState(question.type || 'MCQ');
  const [options, setOptions] = useState(question.options || ['Yes', 'No']);
  const [hasVoice, setHasVoice] = useState(Boolean(question.hasVoice));
  const [isMandatory, setIsMandatory] = useState(Boolean(question.isMandatory));
  const [nextId, setNextId] = useState(question.nextId || '');
  const [nextIfOption, setNextIfOption] = useState(question.nextIfOption || {});
  const [language, setLanguage] = useState(question.language || 'english');

  // Advanced JSON editor (optional)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [nextIfOptionJson, setNextIfOptionJson] = useState(question.nextIfOption ? JSON.stringify(question.nextIfOption, null, 2) : '');

  const onAddOption = () => setOptions((s) => [...s, '']);
  const onChangeOption = (idx, value) => setOptions((s) => s.map((o, i) => (i === idx ? value : o)));
  const onRemoveOption = (idx) => {
    setOptions((s) => {
      const newOptions = s.filter((_, i) => i !== idx);
      return newOptions;
    });

    // shift conditional mapping keys down
    setNextIfOption((prev = {}) => {
      const next = {};
      for (const [k, v] of Object.entries(prev)) {
        const i = Number(k);
        if (i < idx) next[i] = v;
        else if (i > idx) next[i - 1] = v;
      }
      return next;
    });
  };

  const setOptionNext = (idx, toId) => {
    setNextIfOption((prev = {}) => {
      const copy = { ...prev };
      if (!toId) delete copy[idx];
      else copy[idx] = toId;
      return copy;
    });
  };

  const submit = () => {
    if (!id) return alert('ID required');

    // Prevent duplicate ID on create
    if (!question.id && Array.isArray(questions) && questions.find((q) => q.id === id)) {
      return alert('A question with this ID already exists');
    }

    let effectiveNextIfOption = nextIfOption || {};

    // If advanced JSON editor is open, try to parse it and merge
    if (showAdvanced && nextIfOptionJson && nextIfOptionJson.trim()) {
      try {
        const parsed = JSON.parse(nextIfOptionJson);
        effectiveNextIfOption = parsed;
      } catch {
        return alert('Invalid JSON for Conditional mapping');
      }
    }

    // client-side validation for targets (helps catch edited JSON)
    const allIds = (questions || []).map((q) => q.id);
    if (nextId && !allIds.includes(nextId)) return alert('Default Next target not found');
    for (const [k, v] of Object.entries(effectiveNextIfOption || {})) {
      if (!v) continue;
      if (!allIds.includes(v)) return alert(`Invalid conditional target for option ${k}: ${v}`);
      const idx = Number(k);
      if (Number.isNaN(idx) || idx < 0 || idx >= options.length) return alert(`Invalid option index in conditional mapping: ${k}`);
    }

    const cleaned = (type === 'MCQ' && effectiveNextIfOption && Object.keys(effectiveNextIfOption).length > 0)
      ? Object.fromEntries(Object.entries(effectiveNextIfOption).filter(([k, v]) => v != null && v !== '' && Number(k) >= 0 && Number(k) < options.length))
      : undefined;

    const payload = { id, sequence: Number(sequence), text, type, options, hasVoice, isMandatory, language };
    if (nextId) payload.nextId = nextId;
    if (cleaned && Object.keys(cleaned).length > 0) payload.nextIfOption = cleaned;

    onSave(payload);
  };

  const renderQuestionOptions = () => (questions || []).filter((q) => q.id !== id).map((q) => (
    <option key={q.id} value={q.id}>{`${q.id} — ${q.text?.slice(0, 60)}`}</option>
  ));

  return (
    <div className="question-form">
      <div>
        <label>ID</label>
        <input value={id} onChange={(e) => setId(e.target.value)} disabled={Boolean(question.id)} />
      </div>

      <div>
        <label>Sequence</label>
        <input type="number" value={sequence} onChange={(e) => setSequence(e.target.value)} />
      </div>

      <div>
        <label>Text (English)</label>
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </div>

      <div>
        <label>Type</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="MCQ">MCQ</option>
          <option value="TEXT">TEXT</option>
        </select>
      </div>

      <div>
        <label>Options</label>
        <div>
          {options.map((opt, idx) => (
            <div key={idx} style={{ marginBottom: 6, display: 'flex', alignItems: 'center' }}>
              <input value={opt} onChange={(e) => onChangeOption(idx, e.target.value)} style={{ flex: 1 }} />

              {/* Per-option "Next" selector (visual UX for branching) */}
              {type === 'MCQ' && (
                <select value={nextIfOption?.[idx] || ''} onChange={(e) => setOptionNext(idx, e.target.value)} style={{ marginLeft: 8 }}>
                  <option value="">(follow default)</option>
                  {renderQuestionOptions()}
                </select>
              )}

              <button onClick={() => onRemoveOption(idx)} style={{ marginLeft: 6 }}>Remove</button>
            </div>
          ))}
          <button onClick={onAddOption}>Add Option</button>
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <label>Default Next Question</label>
        <select value={nextId || ''} onChange={(e) => setNextId(e.target.value)} style={{ marginLeft: 8 }}>
          <option value="">(follow sequence)</option>
          {renderQuestionOptions()}
        </select>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'inline-block', marginRight: 12 }}><input type="checkbox" checked={hasVoice} onChange={(e) => setHasVoice(e.target.checked)} /> Voice</label>
        <label style={{ display: 'inline-block', marginRight: 12 }}><input type="checkbox" checked={isMandatory} onChange={(e) => setIsMandatory(e.target.checked)} /> Mandatory</label>
        <label style={{ display: 'inline-block' }}>
          Language
          <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ marginLeft: 8 }}>
            <option value="english">English</option>
            <option value="telugu">Telugu</option>
            <option value="hindi">Hindi</option>
            <option value="kannada">Kannada</option>
            <option value="marathi">Marathi</option>
            <option value="tamil">Tamil</option>
          </select>
        </label>
      </div>

      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          onClick={() => {
            const nextOpen = !showAdvanced;
            setShowAdvanced(nextOpen);
            if (nextOpen) {
              setNextIfOptionJson(JSON.stringify(nextIfOption || {}, null, 2));
            }
          }}
          style={{ marginRight: 8 }}
        >
          {showAdvanced ? 'Hide advanced JSON' : 'Edit conditional JSON'}
        </button>
        <small>Use per-option selectors for common cases; advanced JSON for power users.</small>
      </div>

      {showAdvanced && (
        <div style={{ marginTop: 8 }}>
          <textarea value={nextIfOptionJson} onChange={(e) => setNextIfOptionJson(e.target.value)} rows={6} style={{ width: '100%' }} />
          <small>Raw mapping (option index 0-based → question id)</small>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button onClick={submit}>Save</button>
        <button onClick={onCancel} style={{ marginLeft: 8 }}>Cancel</button>
      </div>
    </div>
  );
}
