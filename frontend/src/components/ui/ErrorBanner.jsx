import React from 'react';

export default function ErrorBanner({ message, onRetry }) {
    if (!message) return null;
    return (
        <div className="error" role="alert" aria-live="assertive">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>{message}</div>
                {onRetry && (
                    <div>
                        <button onClick={onRetry} style={{ marginLeft: '1rem' }}>Retry</button>
                    </div>
                )}
            </div>
        </div>
    );
}
