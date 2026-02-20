import { useMemo, useState } from 'react';

export default function QuestionList({ questions = [], onEdit = () => { }, onDelete = () => { }, onReorder = () => { } }) {
  const [draggingId, setDraggingId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);

  const orderedQuestions = useMemo(
    () => [...questions].sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0)),
    [questions]
  );

  if (!questions.length) return <div>No questions yet</div>;

  const buildReorderedIds = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return null;

    const ids = orderedQuestions.map((q) => q.id);
    const sourceIndex = ids.indexOf(sourceId);
    const targetIndex = ids.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return null;

    const next = [...ids];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    return next;
  };

  const handleDrop = async (targetId) => {
    const sourceId = draggingId;
    setDraggingId(null);
    setDropTargetId(null);

    const orderedIds = buildReorderedIds(sourceId, targetId);
    if (!orderedIds) return;

    await onReorder(orderedIds);
  };

  return (
    <table className="question-list" style={{ width: '100%' }}>
      <thead>
        <tr>
          <th>Seq</th>
          <th>ID</th>
          <th>Text (EN)</th>
          <th>Lang</th>
          <th>Transitions</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {orderedQuestions.map((q) => (
          <tr
            key={q.id}
            draggable
            onDragStart={() => {
              setDraggingId(q.id);
              setDropTargetId(q.id);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (dropTargetId !== q.id) setDropTargetId(q.id);
            }}
            onDrop={async (event) => {
              event.preventDefault();
              await handleDrop(q.id);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDropTargetId(null);
            }}
            style={{
              cursor: 'grab',
              opacity: draggingId === q.id ? 0.6 : 1,
              borderTop: dropTargetId === q.id && draggingId && draggingId !== q.id ? '2px solid var(--secondary)' : undefined,
            }}
            title="Drag to reorder question sequence"
          >
            <td>{q.sequence}</td>
            <td>{q.id}</td>
            <td>{q.text}</td>
            <td style={{ textTransform: 'capitalize' }}>{q.language || 'english'}</td>

            <td style={{ whiteSpace: 'pre-wrap' }}>
              {q.nextIfOption && Object.keys(q.nextIfOption).length > 0 ? (
                Object.entries(q.nextIfOption).map(([idx, to]) => <div key={idx}>{idx} → {to}</div>)
              ) : q.nextId ? (
                <div>default → {q.nextId}</div>
              ) : (
                <div>—</div>
              )}
            </td>

            <td>
              <button onClick={() => onEdit(q)}>Edit</button>
              <button onClick={() => onDelete(q.id)} style={{ marginLeft: 8 }}>Delete</button>
              {/* <button onClick={() => onPlayTTS(q)} style={{ marginLeft: 8 }}>Play TTS</button> */}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
