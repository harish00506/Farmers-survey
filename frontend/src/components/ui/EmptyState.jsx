import React from 'react';

export default function EmptyState({ title = 'Nothing here', message = '', actionLabel, onAction }) {
    return (
        <div className="empty-state card" role="status" aria-live="polite">
            <h3 style={{ marginBottom: '0.25rem' }}>{title}</h3>
            {message && <p style={{ marginBottom: '0.75rem', color: '#7f8c8d' }}>{message}</p>}
            {actionLabel && (
                <div>
                    <button onClick={onAction}>{actionLabel}</button>
                </div>
            )}
        </div>
    );
}
