const iconMap = {
    status: (
        <path d="M4 4h16v13H4z M8 13l2.5-2.5 2 2 3.5-4 M10 20h4" />
    ),
    activity: (
        <path d="M4 12h3l2-5 4 10 2-5h5" />
    ),
    users: (
        <path d="M16 21v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1 M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M22 21v-1a4 4 0 0 0-3-3.87 M16 4.13a3 3 0 0 1 0 5.74" />
    ),
    quality: (
        <path d="M4 20h16 M7 16V9 M12 16V5 M17 16v-4" />
    ),
    targeting: (
        <path d="M12 3v4 M12 17v4 M3 12h4 M17 12h4 M12 12m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0" />
    ),
    database: (
        <path d="M5 5c0 1.66 3.13 3 7 3s7-1.34 7-3-3.13-3-7-3-7 1.34-7 3z M5 5v6c0 1.66 3.13 3 7 3s7-1.34 7-3V5 M5 11v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" />
    ),
    chat: (
        <path d="M20 15a3 3 0 0 1-3 3H9l-4 3v-3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z" />
    ),
    queries: (
        <path d="M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6.4 6.4l2.8 2.8 M14.8 14.8l2.8 2.8 M17.6 6.4l-2.8 2.8 M9.2 14.8l-2.8 2.8" />
    ),
};

export default function SectionTitle({ icon = 'status', title, className = '' }) {
    return (
        <h2 className={`section-title ${className}`.trim()}>
            <span className="section-title-icon" aria-hidden="true">
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    {iconMap[icon] || iconMap.status}
                </svg>
            </span>
            <span>{title}</span>
        </h2>
    );
}
