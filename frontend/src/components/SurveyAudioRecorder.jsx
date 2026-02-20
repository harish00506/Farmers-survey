import { useState, useRef } from 'react';
import axios from 'axios';

export default function SurveyAudioRecorder() {
    const [recording, setRecording] = useState(false);
    const [audioUrl, setAudioUrl] = useState(null);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [sessionId, setSessionId] = useState('session_test');
    const [questionId, setQuestionId] = useState('Q1');
    const [status, setStatus] = useState(null);

    const mediaRecorderRef = useRef(null);
    const chunksRef = useRef([]);

    const start = async () => {
        setStatus(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            mediaRecorderRef.current = mr;
            chunksRef.current = [];

            mr.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
            };

            mr.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                const url = URL.createObjectURL(blob);
                setAudioUrl(url);
            };

            mr.start();
            setRecording(true);
        } catch (err) {
            console.error('Microphone access denied', err);
            setStatus('Microphone access denied');
        }
    };

    const stop = () => {
        const mr = mediaRecorderRef.current;
        if (mr && mr.state !== 'inactive') {
            mr.stop();
            setRecording(false);
        }
    };

    const upload = async () => {
        if (!audioUrl) return setStatus('No recording to upload');
        setStatus('Uploading...');

        // Convert blob URL to blob
        const blob = await fetch(audioUrl).then((r) => r.blob());
        const form = new FormData();
        form.append('audio', blob, 'recording.webm');
        form.append('phoneNumber', phoneNumber || 'unknown');
        form.append('questionId', questionId);
        form.append('lat', '');
        form.append('lon', '');

        try {
            const res = await axios.post(`http://localhost:3000/api/survey/${sessionId}/audio`, form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setStatus(`Uploaded: ${res.data.audioId}`);
        } catch (err) {
            console.error('Upload failed', err);
            setStatus('Upload failed');
        }
    };

    return (
        <div className="recorder-card">
            <h3>Survey Audio Recorder (Dev)</h3>
            <div>
                <label>Phone: <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="919876543210" /></label>
                <label>Session: <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} /></label>
                <label>Question: <input value={questionId} onChange={(e) => setQuestionId(e.target.value)} /></label>
            </div>
            <div className="recorder-controls">
                {!recording ? (
                    <button onClick={start}>Start Recording</button>
                ) : (
                    <button onClick={stop}>Stop</button>
                )}
                {audioUrl && (
                    <div>
                        <audio controls src={audioUrl}></audio>
                        <div>
                            <button onClick={upload}>Upload Recording</button>
                        </div>
                    </div>
                )}
                {status && <div className="status">{status}</div>}
            </div>
        </div>
    );
}
