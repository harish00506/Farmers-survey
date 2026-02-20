import { useState, useMemo } from 'react';

export default function TransitionSimulator({ questions = [] }) {
    const qById = useMemo(() => Object.fromEntries((questions || []).map((q) => [q.id, q])), [questions]);
    const seqOrdered = useMemo(() => [...(questions || [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)), [questions]);
    const firstId = seqOrdered[0]?.id || null;

    const [currentId, setCurrentId] = useState(firstId);
    const [history, setHistory] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(null);

    const reset = () => {
        setCurrentId(firstId);
        setHistory([]);
        setSelectedIndex(null);
    };

    const getDefaultNext = (q) => {
        if (!q) return null;
        if (q.nextId) return q.nextId;
        const next = seqOrdered.find((x) => (x.sequence ?? 0) === (q.sequence ?? 0) + 1);
        return next ? next.id : null;
    };

    const computeNext = (q, optIdx) => {
        if (!q) return null;
        if (q.nextIfOption && Object.prototype.hasOwnProperty.call(q.nextIfOption, String(optIdx))) {
            return q.nextIfOption[String(optIdx)];
        }
        const def = getDefaultNext(q);
        return def;
    };

    const onChoose = (idx) => setSelectedIndex(idx);

    const onNext = () => {
        if (!currentId) return;
        const q = qById[currentId];
        const nextId = computeNext(q, selectedIndex);
        setHistory((h) => [...h, { questionId: currentId, selectedIndex }]);
        setCurrentId(nextId || null);
        setSelectedIndex(null);
    };

    const curQ = qById[currentId];

    return (
        <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                    <h4>Simulator</h4>
                    {!curQ ? (
                        <div style={{ padding: 12, border: '1px solid #eee', borderRadius: 6 }}>End of flow</div>
                    ) : (
                        <div style={{ padding: 12, border: '1px solid #eee', borderRadius: 6 }}>
                            <div style={{ fontWeight: 700 }}>{curQ.id}</div>
                            <div style={{ marginTop: 6 }}>{curQ.text}</div>

                            {curQ.options && (
                                <div style={{ marginTop: 12 }}>
                                    {curQ.options.map((opt, idx) => (
                                        <div key={idx} style={{ marginBottom: 6 }}>
                                            <label style={{ display: 'inline-flex', alignItems: 'center' }}>
                                                <input type="radio" name="opt" checked={selectedIndex === idx} onChange={() => onChoose(idx)} />
                                                <span style={{ marginLeft: 8 }}>{opt}</span>
                                                {curQ.nextIfOption && curQ.nextIfOption[String(idx)] ? (
                                                    <span style={{ marginLeft: 12, color: '#0366d6' }}>→ {curQ.nextIfOption[String(idx)]}</span>
                                                ) : null}
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div style={{ marginTop: 12 }}>
                                <button onClick={onNext} disabled={selectedIndex === null}>Next</button>
                                <button onClick={reset} style={{ marginLeft: 8 }}>Reset</button>
                            </div>
                        </div>
                    )}
                </div>

                <div style={{ width: 340 }}>
                    <h4>Path</h4>
                    <div style={{ padding: 12, border: '1px solid #eee', borderRadius: 6 }}>
                        {history.length === 0 ? <div style={{ color: '#666' }}>No steps yet</div> : (
                            <ol>
                                {history.map((h, i) => (
                                    <li key={i}>{h.questionId} — selected: {h.selectedIndex}</li>
                                ))}
                            </ol>
                        )}
                    </div>

                    <div style={{ marginTop: 12 }}>
                        <h4>Controls</h4>
                        <div style={{ fontSize: 13, color: '#666' }}>
                            Start from first question and choose options to step through the flow.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
