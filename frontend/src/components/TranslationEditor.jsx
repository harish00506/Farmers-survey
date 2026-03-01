import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_ROOT = import.meta.env.VITE_API_ROOT || 'http://localhost:3000';

const SUPPORTED_LANGS = [
    { key: 'telugu', label: 'Telugu', script: 'తెలుగు' },
    { key: 'hindi', label: 'Hindi', script: 'हिन्दी' },
    { key: 'kannada', label: 'Kannada', script: 'ಕನ್ನಡ' },
    { key: 'marathi', label: 'Marathi', script: 'मराठी' },
    { key: 'tamil', label: 'Tamil', script: 'தமிழ்' },
];

/**
 * TranslationEditor — inline editor for correcting AI-generated translations.
 *
 * Props:
 * - question: the full question object (with text_<lang>, options_<lang> fields)
 * - surveyId: current survey ID
 * - onClose: callback to close the editor
 * - onSaved: callback after successful save (receives updated question)
 */
export default function TranslationEditor({ question, surveyId, onClose, onSaved }) {
    // Build initial state from the question's existing translations
    const buildInitial = useCallback(() => {
        const state = {};
        for (const lang of SUPPORTED_LANGS) {
            state[lang.key] = {
                text: question?.[`text_${lang.key}`] || '',
                options: Array.isArray(question?.[`options_${lang.key}`])
                    ? [...question[`options_${lang.key}`]]
                    : (question?.options || []).map(() => ''),
            };
        }
        return state;
    }, [question]);

    const [translations, setTranslations] = useState(buildInitial);
    const [activeLang, setActiveLang] = useState(SUPPORTED_LANGS[0].key);
    const [saving, setSaving] = useState(false);
    const [autoTranslating, setAutoTranslating] = useState(false);
    const [status, setStatus] = useState(null);

    // Sync when question prop changes
    useEffect(() => {
        setTranslations(buildInitial());
    }, [buildInitial]);

    const englishText = question?.text || '';
    const englishOptions = question?.options || [];

    const updateText = (lang, value) => {
        setTranslations((prev) => ({
            ...prev,
            [lang]: { ...prev[lang], text: value },
        }));
    };

    const updateOption = (lang, idx, value) => {
        setTranslations((prev) => {
            const opts = [...(prev[lang]?.options || [])];
            opts[idx] = value;
            return { ...prev, [lang]: { ...prev[lang], options: opts } };
        });
    };

    const handleSave = async () => {
        setSaving(true);
        setStatus(null);
        try {
            // Only send languages that have at least some text entered
            const payload = {};
            for (const lang of SUPPORTED_LANGS) {
                const t = translations[lang.key];
                if (t.text || t.options.some((o) => o)) {
                    payload[lang.key] = { text: t.text, options: t.options };
                }
            }

            const res = await axios.patch(
                `${API_ROOT}/api/survey/questions/${encodeURIComponent(question.id)}/translations`,
                { translations: payload, surveyId },
                { params: { surveyId } }
            );

            setStatus({ type: 'success', message: 'Translations saved successfully!' });
            if (onSaved) onSaved(res.data?.question);
        } catch (err) {
            const msg = err?.response?.data?.error || err.message || 'Failed to save translations';
            setStatus({ type: 'error', message: msg });
        } finally {
            setSaving(false);
        }
    };

    const handleAutoTranslate = async (lang) => {
        setAutoTranslating(true);
        setStatus(null);
        try {
            const res = await axios.post(
                `${API_ROOT}/api/survey/questions/${encodeURIComponent(question.id)}/translate`,
                { languages: [lang], surveyId },
                { params: { surveyId } }
            );

            // Fetch the updated question to get the new translations
            const qRes = await axios.get(
                `${API_ROOT}/api/survey/questions/${encodeURIComponent(question.id)}`,
                { params: { surveyId } }
            );
            const updatedQ = qRes.data?.question;
            if (updatedQ) {
                setTranslations((prev) => ({
                    ...prev,
                    [lang]: {
                        text: updatedQ[`text_${lang}`] || '',
                        options: Array.isArray(updatedQ[`options_${lang}`])
                            ? [...updatedQ[`options_${lang}`]]
                            : prev[lang].options,
                    },
                }));
            }

            const transResult = res.data?.translations?.[lang];
            if (transResult?.success) {
                setStatus({ type: 'success', message: `AI translation for ${lang} generated!` });
            } else {
                setStatus({ type: 'error', message: transResult?.error || `AI translation for ${lang} failed` });
            }
        } catch (err) {
            const msg = err?.response?.data?.error || err.message || 'Auto-translate failed';
            setStatus({ type: 'error', message: msg });
        } finally {
            setAutoTranslating(false);
        }
    };

    const handleAutoTranslateAll = async () => {
        setAutoTranslating(true);
        setStatus(null);
        try {
            await axios.post(
                `${API_ROOT}/api/survey/questions/${encodeURIComponent(question.id)}/translate`,
                { languages: SUPPORTED_LANGS.map((l) => l.key), surveyId },
                { params: { surveyId } }
            );

            // Fetch the updated question
            const qRes = await axios.get(
                `${API_ROOT}/api/survey/questions/${encodeURIComponent(question.id)}`,
                { params: { surveyId } }
            );
            const updatedQ = qRes.data?.question;
            if (updatedQ) {
                setTranslations(() => {
                    const state = {};
                    for (const lang of SUPPORTED_LANGS) {
                        state[lang.key] = {
                            text: updatedQ[`text_${lang.key}`] || '',
                            options: Array.isArray(updatedQ[`options_${lang.key}`])
                                ? [...updatedQ[`options_${lang.key}`]]
                                : englishOptions.map(() => ''),
                        };
                    }
                    return state;
                });
            }

            setStatus({ type: 'success', message: 'AI translations generated for all languages!' });
        } catch (err) {
            const msg = err?.response?.data?.error || err.message || 'Auto-translate all failed';
            setStatus({ type: 'error', message: msg });
        } finally {
            setAutoTranslating(false);
        }
    };

    const currentLangInfo = SUPPORTED_LANGS.find((l) => l.key === activeLang);
    const currentTranslation = translations[activeLang] || { text: '', options: [] };

    return (
        <div style={{ minWidth: 700 }}>
            {/* English source (read-only reference) */}
            <div style={{ background: 'var(--light, #f4f4f5)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>
                    English (Source)
                </div>
                <div style={{ fontWeight: 500, marginBottom: 6 }}>{englishText}</div>
                {englishOptions.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {englishOptions.map((opt, i) => (
                            <span
                                key={i}
                                style={{
                                    background: '#fff',
                                    border: '1px solid var(--border, #d1d5db)',
                                    borderRadius: 4,
                                    padding: '2px 8px',
                                    fontSize: 13,
                                }}
                            >
                                {i + 1}. {opt}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Language tabs */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border, #e5e7eb)', marginBottom: 16 }}>
                {SUPPORTED_LANGS.map((lang) => {
                    const hasTranslation = translations[lang.key]?.text?.trim();
                    return (
                        <button
                            key={lang.key}
                            onClick={() => setActiveLang(lang.key)}
                            style={{
                                padding: '8px 16px',
                                border: 'none',
                                borderBottom: activeLang === lang.key ? '2px solid var(--secondary, #3498db)' : '2px solid transparent',
                                background: activeLang === lang.key ? 'rgba(52,152,219,0.08)' : 'transparent',
                                fontWeight: activeLang === lang.key ? 600 : 400,
                                cursor: 'pointer',
                                color: activeLang === lang.key ? 'var(--secondary, #3498db)' : 'inherit',
                                position: 'relative',
                                marginBottom: -2,
                            }}
                        >
                            {lang.label}
                            <span style={{ marginLeft: 4, fontSize: 12, opacity: 0.6 }}>{lang.script}</span>
                            {hasTranslation && (
                                <span
                                    style={{
                                        position: 'absolute',
                                        top: 4,
                                        right: 4,
                                        width: 6,
                                        height: 6,
                                        borderRadius: '50%',
                                        background: 'var(--primary, #2ecc71)',
                                    }}
                                    title="Translation exists"
                                />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Active language editing area */}
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ fontWeight: 600 }}>
                        Question Text ({currentLangInfo?.label})
                    </label>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button
                            onClick={() => handleAutoTranslate(activeLang)}
                            disabled={autoTranslating}
                            style={{ fontSize: 12, padding: '4px 10px' }}
                            title={`Auto-translate to ${currentLangInfo?.label} using AI`}
                        >
                            {autoTranslating ? '⏳ Translating…' : `🤖 AI Translate`}
                        </button>
                    </div>
                </div>

                <textarea
                    value={currentTranslation.text}
                    onChange={(e) => updateText(activeLang, e.target.value)}
                    rows={3}
                    style={{
                        width: '100%',
                        padding: 8,
                        borderRadius: 6,
                        border: '1px solid var(--border, #d1d5db)',
                        fontSize: 15,
                        fontFamily: 'inherit',
                        resize: 'vertical',
                    }}
                    placeholder={`Enter ${currentLangInfo?.label} translation of the question…`}
                />

                {englishOptions.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                        <label style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>
                            Options ({currentLangInfo?.label})
                        </label>
                        {englishOptions.map((engOpt, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <span
                                    style={{
                                        minWidth: 24,
                                        textAlign: 'center',
                                        fontWeight: 600,
                                        color: '#6b7280',
                                        fontSize: 13,
                                    }}
                                >
                                    {idx + 1}.
                                </span>
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <input
                                        value={currentTranslation.options?.[idx] || ''}
                                        onChange={(e) => updateOption(activeLang, idx, e.target.value)}
                                        style={{
                                            width: '100%',
                                            padding: '6px 8px',
                                            borderRadius: 4,
                                            border: '1px solid var(--border, #d1d5db)',
                                            fontSize: 14,
                                        }}
                                        placeholder={`${currentLangInfo?.label} translation…`}
                                    />
                                    <span style={{ fontSize: 11, color: '#9ca3af' }}>EN: {engOpt}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Status */}
            {status && (
                <div
                    style={{
                        marginTop: 12,
                        padding: '8px 12px',
                        borderRadius: 6,
                        fontSize: 13,
                        background: status.type === 'error' ? '#fef2f2' : '#ecfdf5',
                        color: status.type === 'error' ? '#dc2626' : '#059669',
                        border: `1px solid ${status.type === 'error' ? '#fecaca' : '#a7f3d0'}`,
                    }}
                >
                    {status.message}
                </div>
            )}

            {/* Action buttons */}
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                    onClick={handleAutoTranslateAll}
                    disabled={autoTranslating}
                    style={{ fontSize: 13 }}
                    title="Re-generate AI translations for all languages"
                >
                    {autoTranslating ? '⏳ Translating All…' : '🤖 AI Translate All Languages'}
                </button>

                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={onClose}>Cancel</button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        style={{
                            background: 'var(--secondary, #3498db)',
                            color: '#fff',
                            border: 'none',
                            padding: '8px 20px',
                            borderRadius: 6,
                            fontWeight: 600,
                            cursor: saving ? 'not-allowed' : 'pointer',
                        }}
                    >
                        {saving ? 'Saving…' : '💾 Save Translations'}
                    </button>
                </div>
            </div>
        </div>
    );
}
