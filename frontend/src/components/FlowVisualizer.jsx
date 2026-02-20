import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
    Controls,
    Background,
    MiniMap,
    addEdge,
    applyEdgeChanges,
    applyNodeChanges,
    Handle,
    Position,
    ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios';

const normalizeQuestion = (q = {}) => ({
    ...q,
    nextIfOption: q.nextIfOption ? { ...q.nextIfOption } : {},
});

const truncateText = (text = '', max = 58) => {
    const value = String(text || '');
    if (value.length <= max) return value;
    return `${value.slice(0, max - 1)}…`;
};

const normalizeTransitionMap = (map = {}) => {
    const entries = Object.entries(map || {})
        .filter(([, to]) => Boolean(to))
        .map(([idx, to]) => [String(idx), String(to)]);

    entries.sort(([a], [b]) => Number(a) - Number(b));
    return Object.fromEntries(entries);
};

const signatureFromState = (qs = []) => {
    const normalized = [...(qs || [])]
        .map((q) => ({
            id: q.id,
            nextId: q.nextId || null,
            nextIfOption: normalizeTransitionMap(q.nextIfOption || {}),
            position: q._position || null,
        }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));

    return JSON.stringify(normalized);
};

const detectCycle = (qs = []) => {
    const edgesAdj = {};
    for (const q of qs) {
        const from = q.id;
        const targets = new Set();
        const defaultNext = q.nextId ?? (qs.find((x) => x.sequence === q.sequence + 1)?.id);
        if (defaultNext) targets.add(defaultNext);
        if (q.nextIfOption) {
            for (const to of Object.values(q.nextIfOption)) {
                if (to) targets.add(to);
            }
        }
        edgesAdj[from] = Array.from(targets);
    }

    const visited = new Set();
    const inStack = new Set();

    const dfs = (node) => {
        if (inStack.has(node)) return true;
        if (visited.has(node)) return false;

        visited.add(node);
        inStack.add(node);

        for (const next of edgesAdj[node] || []) {
            if (dfs(next)) return true;
        }

        inStack.delete(node);
        return false;
    };

    for (const node of Object.keys(edgesAdj)) {
        if (!visited.has(node) && dfs(node)) return true;
    }

    return false;
};

const getBrokenTransitions = (qs = []) => {
    const ids = new Set((qs || []).map((q) => q.id));
    const broken = [];

    for (const q of qs) {
        if (q.nextId && !ids.has(q.nextId)) {
            broken.push({ from: q.id, kind: 'default', target: q.nextId });
        }

        for (const [idx, target] of Object.entries(q.nextIfOption || {})) {
            if (target && !ids.has(target)) {
                broken.push({ from: q.id, kind: `option ${idx}`, target });
            }
        }
    }

    return broken;
};

const QuestionNode = ({ data, selected }) => {
    const question = data?.question || {};

    return (
        <div
            className="flow-node-card"
            title={question.text || ''}
            style={{
                borderColor: selected ? 'var(--secondary)' : question.isStart ? 'var(--primary)' : 'var(--border)',
            }}
        >
            <Handle type="target" position={Position.Left} />
            <div className="flow-node-header">
                <span className="flow-node-id">{question.id}</span>
                {question.isStart && <span className="flow-node-badge">Start</span>}
            </div>
            <div className="flow-node-text">{truncateText(question.text || '', 74)}</div>
            <div className="flow-node-footer">
                <span>{Array.isArray(question.options) ? `${question.options.length} options` : 'No options'}</span>
                <span className="drag-handle" title="Drag to move">≡</span>
            </div>
            <Handle type="source" position={Position.Right} />
        </div>
    );
};

const nodeTypes = {
    questionNode: QuestionNode,
};

export default function FlowVisualizer({ questions = [], surveyId = 'survey1', onDirtyChange = () => { }, onRequestClose = () => { } }) {
    const API_ROOT = import.meta.env.VITE_API_ROOT || 'http://localhost:3000';
    const COLUMN_X = 40;
    const COLUMN_START_Y = 20;
    const COLUMN_Y_GAP = 190;

    const [localQs, setLocalQs] = useState([]);
    const [nodes, setNodes] = useState([]);
    const [edges, setEdges] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [saving, setSaving] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);

    const baseSignature = useMemo(() => signatureFromState((questions || []).map(normalizeQuestion)), [questions]);

    useEffect(() => {
        const initial = (questions || []).map(normalizeQuestion);
        setLocalQs(initial);
        setSelectedId(null);
    }, [questions]);

    const hasCycle = useMemo(() => detectCycle(localQs), [localQs]);
    const brokenTransitions = useMemo(() => getBrokenTransitions(localQs), [localQs]);
    const isDirty = useMemo(() => signatureFromState(localQs) !== baseSignature, [localQs, baseSignature]);

    useEffect(() => {
        onDirtyChange(Boolean(isDirty));
    }, [isDirty, onDirtyChange]);

    const selectedQuestion = useMemo(
        () => (localQs || []).find((q) => q.id === selectedId) || null,
        [localQs, selectedId]
    );

    const questionIds = useMemo(() => new Set((localQs || []).map((q) => q.id)), [localQs]);

    useEffect(() => {
        const startQuestionId = (localQs || [])
            .slice()
            .sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0))?.[0]?.id || null;

        const nodeList = (localQs || []).map((q) => ({
            id: q.id,
            type: 'questionNode',
            data: {
                question: {
                    ...q,
                    isStart: q.id === startQuestionId,
                },
            },
            position: q._position || {
                x: COLUMN_X,
                y: (Number(q.sequence ?? 0) * COLUMN_Y_GAP) + COLUMN_START_Y,
            },
            draggable: true,
            dragHandle: '.drag-handle',
        }));

        const edgeList = [];
        for (const q of localQs) {
            if (q.nextIfOption) {
                for (const [idx, toId] of Object.entries(q.nextIfOption)) {
                    if (!toId || !questionIds.has(toId)) continue;
                    edgeList.push({
                        id: `e-${q.id}-${toId}-c-${idx}`,
                        source: q.id,
                        target: toId,
                        label: `Option ${Number(idx) + 1}`,
                        animated: true,
                        style: { stroke: 'var(--accent)', strokeWidth: 2 },
                        labelStyle: { fill: 'var(--dark)', fontWeight: 600 },
                        data: { optionIndex: Number(idx) },
                    });
                }
            }

            const defaultNext = q.nextId ?? (localQs.find((x) => x.sequence === q.sequence + 1)?.id);
            if (defaultNext && questionIds.has(defaultNext)) {
                edgeList.push({
                    id: `e-${q.id}-${defaultNext}-d`,
                    source: q.id,
                    target: defaultNext,
                    label: 'Default',
                    style: { stroke: 'var(--secondary)', strokeWidth: 2 },
                    labelStyle: { fill: 'var(--dark)', fontWeight: 600 },
                });
            }
        }

        setNodes(nodeList);
        setEdges(edgeList);
    }, [localQs, questionIds]);

    const updateLocalQuestion = useCallback((id, patch) => {
        setLocalQs((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
    }, []);

    const onNodesChange = useCallback((changes) => {
        setNodes((prev) => applyNodeChanges(changes, prev));
    }, []);

    const onEdgesChange = useCallback((changes) => {
        setEdges((prev) => applyEdgeChanges(changes, prev));
    }, []);

    const onNodeClick = useCallback((_, node) => {
        setSelectedId(node.id);
    }, []);

    const onNodeDragStop = useCallback((_, node) => {
        updateLocalQuestion(node.id, { _position: node.position });
    }, [updateLocalQuestion]);

    const onConnect = useCallback((conn) => {
        if (!conn?.source || !conn?.target || conn.source === conn.target) return;

        setEdges((prev) => addEdge({ ...conn, id: `e-${conn.source}-${conn.target}-d`, label: 'Default' }, prev));
        setLocalQs((prev) => prev.map((q) => (q.id === conn.source ? { ...q, nextId: conn.target } : q)));
    }, []);

    const resetLocal = useCallback(() => {
        setLocalQs((questions || []).map(normalizeQuestion));
        setSelectedId(null);
        setShowAdvanced(false);
    }, [questions]);

    const onAutoArrange = useCallback(() => {
        const sorted = [...localQs].sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0));

        const positionById = new Map(
            sorted.map((q, idx) => [
                q.id,
                {
                    x: COLUMN_X,
                    y: (idx * COLUMN_Y_GAP) + COLUMN_START_Y,
                },
            ])
        );

        setLocalQs((prev) => prev.map((q) => ({ ...q, _position: positionById.get(q.id) || q._position })));
    }, [localQs, COLUMN_X, COLUMN_START_Y, COLUMN_Y_GAP]);

    const onSaveAll = async () => {
        if (hasCycle) {
            alert('Flow has a cycle. Please fix it before saving.');
            return;
        }

        if (brokenTransitions.length > 0) {
            alert('Flow has invalid transitions pointing to missing questions. Please fix them before saving.');
            return;
        }

        setSaving(true);
        try {
            for (const q of localQs) {
                const original = (questions || []).find((x) => x.id === q.id) || {};
                const payload = {};

                if ((q.nextId || null) !== (original.nextId || null)) {
                    payload.nextId = q.nextId || null;
                }

                if (JSON.stringify(normalizeTransitionMap(q.nextIfOption || {})) !== JSON.stringify(normalizeTransitionMap(original.nextIfOption || {}))) {
                    payload.nextIfOption = normalizeTransitionMap(q.nextIfOption || {});
                }

                if (JSON.stringify(q._position || null) !== JSON.stringify(original._position || null)) {
                    payload._position = q._position || null;
                }

                if (Object.keys(payload).length === 0) continue;

                await axios.put(
                    `${API_ROOT}/api/survey/questions/${q.id}`,
                    { ...payload, surveyId },
                    { params: { surveyId } }
                );
            }

            alert('Flow updated successfully.');
        } catch (err) {
            const serverMsg = err?.response?.data?.error?.message || err?.response?.data?.error || err?.message || 'Save failed';
            alert(`Save failed: ${serverMsg}`);
            console.error('Flow save error:', err?.response?.data || err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flow-editor-layout">
            <div className="flow-canvas-card">
                <ReactFlowProvider>
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        nodeTypes={nodeTypes}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onNodeClick={onNodeClick}
                        onNodeDragStop={onNodeDragStop}
                        fitView
                        fitViewOptions={{ padding: 0.18 }}
                        style={{ width: '100%', height: '100%' }}
                        panOnScroll
                    >
                        <Background gap={20} size={1} />
                        <MiniMap pannable zoomable />
                        <Controls showInteractive />
                    </ReactFlow>
                </ReactFlowProvider>
            </div>

            <div className="flow-side-card">
                <div className="flow-side-top">
                    <h4>Flow Editor</h4>
                    <div className="flow-actions-row">
                        <button onClick={onSaveAll} disabled={saving || !isDirty}>{saving ? 'Saving...' : 'Save'}</button>
                        <button onClick={resetLocal} disabled={!isDirty || saving}>Reset</button>
                        <button onClick={onAutoArrange} disabled={saving}>Auto-arrange</button>
                        <button onClick={onRequestClose}>Close</button>
                    </div>
                </div>

                <p className="flow-helper-text">
                    Drag nodes using the ≡ handle, click a node to edit transitions, and connect nodes visually to change default next.
                </p>

                {isDirty && <div className="flow-unsaved-banner">You have unsaved flow changes.</div>}

                {brokenTransitions.length > 0 && (
                    <div className="flow-warning-banner">
                        {brokenTransitions.length} broken transition{brokenTransitions.length > 1 ? 's' : ''} detected. Update or clear missing targets.
                    </div>
                )}

                <div className="flow-summary-block">
                    <strong>Summary</strong>
                    <div>Total nodes: {localQs.length}</div>
                    <div>Total edges: {edges.length}</div>
                    <div>{hasCycle ? 'Cycle detected. Fix before saving.' : 'No cycle detected.'}</div>
                </div>

                <hr />

                {!selectedQuestion ? (
                    <div className="flow-empty-state">Select any node to edit transitions.</div>
                ) : (
                    <div className="flow-detail-panel">
                        <div className="flow-selected-head">
                            <strong>{selectedQuestion.id}</strong>
                            <span>{truncateText(selectedQuestion.text || '', 90)}</span>
                        </div>

                        <div>
                            <label>Default next question</label>
                            <select
                                value={selectedQuestion.nextId || ''}
                                onChange={(event) => updateLocalQuestion(selectedQuestion.id, { nextId: event.target.value || null })}
                            >
                                <option value="">(Follow sequence / End)</option>
                                {(localQs || []).filter((q) => q.id !== selectedQuestion.id).map((q) => (
                                    <option key={q.id} value={q.id}>{`${q.id} — ${truncateText(q.text || '', 48)}`}</option>
                                ))}
                            </select>
                        </div>

                        {Array.isArray(selectedQuestion.options) && selectedQuestion.options.length > 0 && (
                            <div>
                                <label>Option routing</label>
                                <div className="flow-options-grid">
                                    {selectedQuestion.options.map((option, idx) => (
                                        <div key={idx} className="flow-option-row">
                                            <span title={option}>{`#${idx + 1} ${truncateText(option, 34)}`}</span>
                                            <select
                                                value={(selectedQuestion.nextIfOption || {})[idx] || ''}
                                                onChange={(event) => {
                                                    const copy = { ...(selectedQuestion.nextIfOption || {}) };
                                                    if (!event.target.value) delete copy[idx];
                                                    else copy[idx] = event.target.value;
                                                    updateLocalQuestion(selectedQuestion.id, { nextIfOption: copy });
                                                }}
                                            >
                                                <option value="">(Use default)</option>
                                                {(localQs || []).filter((q) => q.id !== selectedQuestion.id).map((q) => (
                                                    <option key={q.id} value={q.id}>{`${q.id} — ${truncateText(q.text || '', 42)}`}</option>
                                                ))}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <button type="button" onClick={() => setShowAdvanced((prev) => !prev)}>
                            {showAdvanced ? 'Hide Advanced' : 'Show Advanced'}
                        </button>

                        {showAdvanced && (
                            <div className="flow-advanced-box">
                                <button
                                    type="button"
                                    onClick={() => updateLocalQuestion(selectedQuestion.id, { nextIfOption: {} })}
                                    className="btn-danger"
                                >
                                    Clear option mappings
                                </button>
                                <button
                                    type="button"
                                    onClick={() => updateLocalQuestion(selectedQuestion.id, { nextId: null })}
                                    className="btn-danger"
                                >
                                    Clear default next
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
