import React from 'react';

export function Line({ width = '100%', height = 12, style = {} }) {
    return <div className="skeleton line" style={{ width, height, ...style }} />;
}

export function Circle({ size = 40, style = {} }) {
    return <div className="skeleton circle" style={{ width: size, height: size, borderRadius: '50%', ...style }} />;
}

export function Block({ width = '100%', height = 80, style = {} }) {
    return <div className="skeleton block" style={{ width, height, ...style }} />;
}

export default function Skeleton({ lines = 3 }) {
    return (
        <div>
            {Array.from({ length: lines }).map((_, i) => (
                <div key={i} style={{ marginBottom: '0.75rem' }}>
                    <Line />
                </div>
            ))}
        </div>
    );
}
