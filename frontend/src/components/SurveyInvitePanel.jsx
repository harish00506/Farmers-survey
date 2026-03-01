import { useEffect, useState } from 'react';
import axios from 'axios';

const WHATSAPP_TEST_NUMBER = '+15551804452';

const INVITE_METHODS = [
  { id: 'phone', title: 'Phone invite', subtitle: 'Push a WhatsApp message to a farmer number' },
  { id: 'qr', title: 'QR code', subtitle: 'Generate a poster-ready scan link for any farmer' },
];

const toErrorMessage = (error, fallback) => {
  const data = error?.response?.data;
  const directMessage =
    data?.message
    || data?.error?.message
    || data?.error
    || error?.message;

  if (typeof directMessage === 'string') {
    return directMessage;
  }
  if (directMessage && typeof directMessage === 'object' && typeof directMessage.message === 'string') {
    return directMessage.message;
  }

  return fallback;
};

export default function SurveyInvitePanel() {
  const [channel, setChannel] = useState('phone');
  const [inviteMode, setInviteMode] = useState('single');
  const [phoneNumber, setPhoneNumber] = useState(WHATSAPP_TEST_NUMBER);
  const [bulkPhoneNumbers, setBulkPhoneNumbers] = useState('');
  const [bulkFile, setBulkFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [qrPayload, setQrPayload] = useState(null);
  const [copied, setCopied] = useState(false);
  const [bulkJobId, setBulkJobId] = useState(null);
  const [inviteSurveyId, setInviteSurveyId] = useState('survey1');
  const [surveys, setSurveys] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const loadSurveys = async () => {
      try {
        const response = await axios.get('/api/survey/surveys');
        const docs = Array.isArray(response.data?.surveys) ? response.data.surveys : [];
        if (cancelled) return;

        setSurveys(docs);

        setInviteSurveyId((prev) => {
          if (docs.length === 0) return prev;
          const exists = docs.some((survey) => survey.id === prev);
          return exists ? prev : docs[0].id;
        });
      } catch {
        if (cancelled) return;
        setSurveys([]);
      }
    };

    loadSurveys();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!bulkJobId) return undefined;

    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const res = await axios.get(`/api/whatsapp/invite/jobs/${bulkJobId}`);
        const job = res.data?.job;
        if (!job) return;

        const progress = `${job.processedCount}/${job.totalCount}`;
        if (job.status === 'completed') {
          const failed = Array.isArray(job.failures) ? job.failures : [];
          const failSuffix = failed.length > 0
            ? ` Failed numbers: ${failed.slice(0, 10).map((item) => item.phoneNumber).join(', ')}${failed.length > 10 ? ' ...' : ''}`
            : '';
          const firstFailureError = failed.find((item) => item?.error)?.error || '';
          const has24HourPolicyFailure = /131047|24\s*hours|re-?engagement/i.test(firstFailureError);
          const failureHint = has24HourPolicyFailure
            ? ' One or more recipients are outside WhatsApp\'s 24-hour customer-care window. Use an approved template invite for those numbers.'
            : '';

          setStatus({
            type: failed.length > 0 ? 'error' : 'success',
            message: `Bulk invite completed. Success: ${job.successCount}, Failed: ${job.failureCount}.${failSuffix}${failureHint}`,
          });
          setBulkJobId(null);
        } else if (job.status === 'failed') {
          setStatus({ type: 'error', message: `Bulk invite job failed: ${job.error || 'Unknown error'}` });
          setBulkJobId(null);
        } else {
          setStatus({ type: 'success', message: `Bulk invite in progress: ${progress} processed.` });
        }
      } catch {
        setStatus({ type: 'error', message: 'Failed to fetch bulk invite status.' });
        setBulkJobId(null);
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [bulkJobId]);

  const handleChannelChange = (method) => {
    setChannel(method);
    setStatus(null);
    setQrPayload(null);
    if (method === 'qr') {
      setInviteMode('single');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus(null);

    if (channel === 'phone') {
      if (inviteMode === 'single' && !phoneNumber.trim()) {
        setStatus({ type: 'error', message: 'Enter the phone number before sending invite.' });
        return;
      }

      if (inviteMode === 'bulk') {
        if (bulkFile) {
          // CSV upload mode can proceed without textarea content
          return;
        }

        const parsed = bulkPhoneNumbers
          .split(/[\n,]+/)
          .map((item) => item.trim())
          .filter(Boolean);

        if (parsed.length === 0) {
          setStatus({ type: 'error', message: 'Enter at least one phone number for bulk invite.' });
          return;
        }
      }
    }

    setLoading(true);
    try {
      if (channel === 'phone' && inviteMode === 'bulk' && bulkFile) {
        const form = new FormData();
        form.append('file', bulkFile);
        form.append('surveyId', (inviteSurveyId || 'survey1').trim());
        const uploadRes = await axios.post('/api/whatsapp/invite/upload', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        const data = uploadRes.data || {};
        if (data.inviteType === 'bulk_async') {
          setBulkJobId(data.jobId || null);
          setStatus({
            type: 'success',
            message: data.message || `Bulk invite queued for ${data.totalCount || 0} users from CSV.`,
          });
          setQrPayload(null);
          setLoading(false);
          return;
        }
      }

      const payload = { channel, surveyId: (inviteSurveyId || 'survey1').trim() };
      if (channel === 'phone' && inviteMode === 'single' && phoneNumber.trim()) {
        payload.phoneNumber = phoneNumber.trim();
      }

      if (channel === 'phone' && inviteMode === 'bulk') {
        payload.phoneNumbers = bulkPhoneNumbers
          .split(/[\n,]+/)
          .map((item) => item.trim())
          .filter(Boolean);
        payload.async = true;
      }

      const response = await axios.post('/api/whatsapp/invite', payload);
      const data = response.data || {};

      if (data.inviteType === 'qr') {
        setQrPayload({
          link: data.qrLink,
          imageUrl: data.qrImageUrl,
          instructions: data.instructions,
        });
        setStatus({ type: 'success', message: data.instructions });
      } else if (data.inviteType === 'bulk') {
        const failureCount = Array.isArray(data.failures) ? data.failures.length : 0;
        const failedList = Array.isArray(data.failures) ? data.failures : [];
        const failedPhones = failureCount > 0
          ? ` Failed numbers: ${failedList.map((f) => f.phoneNumber).join(', ')}`
          : '';
        const firstFailureError = failedList.find((item) => item?.error)?.error || '';
        const has24HourPolicyFailure = /131047|24\s*hours|re-?engagement/i.test(firstFailureError);
        const failureHint = has24HourPolicyFailure
          ? ' One or more recipients are outside WhatsApp\'s 24-hour customer-care window. Use an approved template invite for those numbers.'
          : '';

        setStatus({
          type: failureCount > 0 ? 'error' : 'success',
          message: `${data.message || 'Bulk invite complete.'}${failedPhones}${failureHint}`,
        });
        setQrPayload(null);
      } else if (data.inviteType === 'bulk_async') {
        setBulkJobId(data.jobId || null);
        setStatus({
          type: 'success',
          message: data.message || `Bulk invite queued for ${data.totalCount || 0} users.`,
        });
        setQrPayload(null);
      } else {
        setStatus({ type: 'success', message: data.message || `Invite sent to ${data.phoneNumber || phoneNumber}` });
        setQrPayload(null);
      }
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to seed the invite right now.');
      setStatus({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!qrPayload) return;
    try {
      await navigator.clipboard.writeText(qrPayload.link);
      setCopied(true);
      setStatus({ type: 'success', message: 'Invite link copied to clipboard.' });
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setStatus({ type: 'error', message: 'Copy blocked. Use the link directly below the QR.' });
    }
  };

  return (
    <div className="card invite-card">
      <div className="invite-hero">
        <div>
          <p className="tone">⚡ Field-to-chat dispatch</p>
          <h2>Invite Farmers</h2>
          <p>
            Send single or bulk WhatsApp invites, or generate a QR invite link for farmers.
          </p>
        </div>
        {/* <span className="invite-badge">Phase 1</span> */}

      </div>

      <form className="invite-form" onSubmit={handleSubmit}>
        <div className="method-pills">
          {INVITE_METHODS.map((method) => (
            <button
              type="button"
              key={method.id}
              className={`method-pill ${channel === method.id ? 'active' : ''}`}
              onClick={() => handleChannelChange(method.id)}
            >
              <strong>{method.title}</strong>
              <span>{method.subtitle}</span>
            </button>
          ))}
        </div>

        <div className="form-grid">
          <label htmlFor="invite-survey-id">Invite survey ID</label>
          <select id="invite-survey-id" value={inviteSurveyId} onChange={(event) => setInviteSurveyId(event.target.value)}>
            {surveys.length === 0 ? (
              <option value="survey1">survey1</option>
            ) : surveys.map((survey) => (
              <option key={survey.id} value={survey.id}>{survey.name || survey.id}</option>
            ))}
          </select>

          {channel === 'phone' && (
            <div className="invite-mode-toggle">
              <button
                type="button"
                className={inviteMode === 'single' ? 'active' : ''}
                onClick={() => setInviteMode('single')}
              >
                Single invite
              </button>
              <button
                type="button"
                className={inviteMode === 'bulk' ? 'active' : ''}
                onClick={() => setInviteMode('bulk')}
              >
                Bulk invite
              </button>
            </div>
          )}

          {inviteMode === 'single' || channel === 'qr' ? (
            <>
              <label htmlFor="invite-phone">Phone number</label>
              <input
                id="invite-phone"
                type="tel"
                placeholder="+91 98765 43210"
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                disabled={channel === 'qr'}
              />
              <small className="input-hint">Test WhatsApp dialogue: {WHATSAPP_TEST_NUMBER}</small>
            </>
          ) : (
            <>
              <label htmlFor="invite-bulk-phones">Phone numbers (one per line or comma separated)</label>
              <textarea
                id="invite-bulk-phones"
                placeholder={'+91 98765 43210\n+91 91234 56789\n+91 99887 76655'}
                value={bulkPhoneNumbers}
                onChange={(event) => setBulkPhoneNumbers(event.target.value)}
                rows={5}
              />
              <small className="input-hint">Bulk mode will send invite to all valid numbers.</small>

              <label htmlFor="invite-bulk-file" style={{ marginTop: '0.5rem' }}>Or upload CSV/TXT file</label>
              <input
                id="invite-bulk-file"
                type="file"
                accept=".csv,.txt"
                onChange={(event) => setBulkFile(event.target.files?.[0] || null)}
              />
              <small className="input-hint">CSV can include one phone per row (or phone in first column).</small>
            </>
          )}
        </div>


        <div className="form-footer">
          <button type="submit" disabled={loading}>
            {channel === 'qr' ? 'Generate QR invite' : inviteMode === 'bulk' ? 'Send bulk WhatsApp invites' : 'Send WhatsApp invite'}
          </button>
          <p className="helper-note">
            {channel === 'qr'
              ? 'Share the QR in the field. Farmers scan it to open WhatsApp and send START.'
              : inviteMode === 'bulk'
                ? 'We will send invites to all listed numbers in one action.'
                : 'We will seed the chat. Ask them to reply START (and the OTP if enabled) to begin.'}
          </p>
        </div>
      </form>

      {status && (
        <div className={`status ${status.type === 'error' ? 'error' : 'success'}`}>
          {status.message}
        </div>
      )}

      {channel === 'qr' && qrPayload && (
        <div className="qr-preview">
          <img src={qrPayload.imageUrl} alt="Survey invite QR" />
          <div className="qr-meta">
            <p>{qrPayload.instructions}</p>
            <div>
              <a href={qrPayload.link} target="_blank" rel="noreferrer">
                Open link
              </a>
              <button type="button" onClick={handleCopy}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
