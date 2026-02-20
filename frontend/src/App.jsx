import { useState, useEffect } from 'react';
import './App.css';
import SurveyMonitor from './components/SurveyMonitor';
import FarmerTracker from './components/FarmerTracker';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import AIChatPanel from './components/AIChatPanel';
import QCAudioPanel from './components/QCAudioPanel';
import ThemeToggle from './components/ThemeToggle';
import QuestionsEditor from './components/QuestionsEditor';
import axios from 'axios';
import {
  clearAuthSession,
  getAuthUser,
  setAuthToken,
  setAuthUser,
} from './lib/authStorage';

function KPI({ title, metric, isAllTime = false }) {
  const arrow = metric.trend === 'up' ? '▲' : metric.trend === 'down' ? '▼' : '–';
  return (
    <div className={`kpi-card kpi-${metric.color}`}>
      <div className="kpi-title">{title}</div>
      <div className="kpi-main">
        <div className="kpi-value">{metric.current}</div>
        <div className="kpi-meta">
          {isAllTime ? (
            <small className="kpi-prev">all-time</small>
          ) : (
            <>
              <span className="kpi-change">{arrow} {Math.abs(metric.changePercent)}%</span>
              <small className="kpi-prev">vs prev</small>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('monitor');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [kpis, setKpis] = useState(null);
  const [kpiRange, setKpiRange] = useState('weekly');
  const [kpiError, setKpiError] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(() => getAuthUser());
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);
  const [surveyName, setSurveyName] = useState('');
  const [surveyNameBusy, setSurveyNameBusy] = useState(false);
  const [surveyNameError, setSurveyNameError] = useState(null);

  const env = import.meta?.env?.MODE || 'dev';
  const isAuthenticated = Boolean(currentUser);
  const activeSurveyName = String(currentUser?.surveyName || '').trim();
  const requiresSurveyName = isAuthenticated && !activeSurveyName;

  useEffect(() => {
    restoreSession();
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      clearAuthSession();
      setCurrentUser(null);
      setKpis(null);
      setKpiRange('weekly');
      setKpiError('Session expired. Please login again.');
    };

    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchKPIs();
    const id = setInterval(fetchKPIs, 10000);
    return () => clearInterval(id);
  }, [isAuthenticated]);

  async function restoreSession() {
    try {
      const res = await axios.get('/api/auth/me');
      setCurrentUser(res.data.user || getAuthUser());
      if (res.data.user) {
        setAuthUser(res.data.user);
      }
      setAuthError(null);
    } catch {
      clearAuthSession();
      setCurrentUser(null);
    } finally {
      setAuthLoading(false);
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    setAuthError(null);

    if (!email.trim() || !password.trim()) {
      setAuthError('Email and password are required.');
      return;
    }

    setAuthBusy(true);
    try {
      const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const res = await axios.post(endpoint, {
        email: email.trim(),
        password,
      });

      setAuthToken(res.data.token);
      setAuthUser(res.data.user);
      setCurrentUser(res.data.user);
      setKpiError(null);
    } catch (err) {
      const message = err?.response?.data?.error || 'Authentication failed';
      setAuthError(message);
    } finally {
      setAuthBusy(false);
    }
  }

  function logout() {
    clearAuthSession();
    setCurrentUser(null);
    setKpis(null);
    setKpiRange('weekly');
    setAuthError(null);
    setSurveyName('');
    setSurveyNameError(null);
  }

  async function deleteAccount() {
    const confirmed = window.confirm('Delete your account permanently? This will remove your surveys, questions, farmers, answers, sessions, and related data. This action cannot be undone.');
    if (!confirmed) return;

    setDeleteAccountBusy(true);
    setAuthError(null);

    try {
      await axios.delete('/api/auth/account');
      clearAuthSession();
      setCurrentUser(null);
      setKpis(null);
      setKpiRange('weekly');
      setKpiError('Your account has been deleted.');
      setSurveyName('');
      setSurveyNameError(null);
    } catch (err) {
      const message = err?.response?.data?.error || 'Failed to delete account';
      setAuthError(message);
    } finally {
      setDeleteAccountBusy(false);
    }
  }

  async function submitSurveyName(event) {
    event.preventDefault();
    setSurveyNameError(null);
    const normalizedSurveyName = surveyName.trim();

    if (!normalizedSurveyName) {
      setSurveyNameError('Survey name is required.');
      return;
    }

    setSurveyNameBusy(true);
    try {
      const res = await axios.put('/api/auth/survey-name', { surveyName: normalizedSurveyName });
      const updatedUser = res.data?.user;
      if (updatedUser) {
        setCurrentUser(updatedUser);
        setAuthUser(updatedUser);
      }
      setSurveyName('');
    } catch (err) {
      const message = err?.response?.data?.error || 'Failed to update survey name';
      setSurveyNameError(message);
    } finally {
      setSurveyNameBusy(false);
    }
  }

  async function fetchKPIs() {
    try {
      const res = await axios.get('/api/analytics/kpis?range=all');
      const payload = res.data || {};
      setKpis(payload.kpis || payload);
      setKpiRange(payload.range || 'weekly');
      setKpiError(null);
    } catch (err) {
      console.error('Failed to load KPIs', err);
      setKpiError('Failed to load KPIs');
      setKpis(null);
      setKpiRange('weekly');
    }
  }

  if (authLoading) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h2>Loading...</h2>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="auth-shell">
        <form className="auth-card" onSubmit={submitAuth}>
          <div className="auth-header-block">
            <span className="auth-badge">🌾 Survey Platform</span>
            <h2>{authMode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
            <p className="auth-subtitle">Login or create account to access survey dashboard.</p>
          </div>

          <div className="auth-tabs">
            <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Login</button>
            <button type="button" className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>Sign Up</button>
          </div>

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
            />
          </div>

          {authError && <div className="error">{authError}</div>}

          <button type="submit" disabled={authBusy} className="auth-submit">
            {authBusy ? 'Please wait...' : authMode === 'signup' ? 'Create Account' : 'Login'}
          </button>

        </form>
      </div>
    );
  }

  return (
    <div className="app-container layout">
      <header className="app-header top-header">
        <div className="header-left">
          <button className="hamburger" onClick={() => setSidebarOpen((s) => !s)} aria-label="Toggle navigation">☰</button>
          <div>
            <h1>🌾 {activeSurveyName || 'Survey Analytics'}</h1>
            <p className="subtitle">AI-enabled WhatsApp survey management platform</p>
          </div>
        </div>
        <div className="header-right">
          <ThemeToggle />
          <span className="user-chip">{currentUser?.email}</span>
          <button type="button" onClick={logout}>Logout</button>
          <button type="button" className="btn-danger" onClick={deleteAccount} disabled={deleteAccountBusy}>
            {deleteAccountBusy ? 'Deleting...' : 'Delete Account'}
          </button>
          <span className={`env-badge ${env === 'production' ? 'prod' : 'dev'}`}>
            {env === 'production' ? (
              <img src="/logo.png" alt="Production" className="env-logo" />
            ) : (
              'DEV'
            )}
          </span>
        </div>

        <div className="kpi-row">
          {kpiError && <div className="error">{kpiError}</div>}
          {!kpis ? (
            <div className="kpi-loading">Loading KPIs…</div>
          ) : (
            <>
              <KPI title="Total Respondents" metric={kpis.totalFarmers} isAllTime={kpiRange === 'all'} />
              <KPI title="Completed Responses" metric={kpis.completedSurveys} isAllTime={kpiRange === 'all'} />
              <KPI title="In Progress" metric={kpis.inProgress} isAllTime={kpiRange === 'all'} />
              <KPI title="Dropouts" metric={kpis.dropouts} isAllTime={kpiRange === 'all'} />
            </>
          )}
        </div>
      </header>

      <div className="app-body">
        <aside className={`app-sidebar ${sidebarOpen ? 'open' : 'collapsed'}`}>
          <nav>
            <button className={`nav-link ${activeTab === 'monitor' ? 'active' : ''}`} onClick={() => setActiveTab('monitor')}>📊 <span className="label">Survey Monitor</span></button>
            <button className={`nav-link ${activeTab === 'farmers' ? 'active' : ''}`} onClick={() => setActiveTab('farmers')}>👥 <span className="label">Respondent Tracker</span></button>
            <button className={`nav-link ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}>📈 <span className="label">Analytics</span></button>
            <button className={`nav-link ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>🤖 <span className="label">Chat with Data</span></button>
            <button className={`nav-link ${activeTab === 'editor' ? 'active' : ''}`} onClick={() => setActiveTab('editor')}>✏️ <span className="label">Survey Editor</span></button>
            {/* <button className={`nav-link ${activeTab === 'recorder' ? 'active' : ''}`} onClick={() => setActiveTab('recorder')}>🎤 <span className="label">Recorder</span></button> */}
          </nav>
        </aside>

        <main className="app-main">
          {activeTab === 'monitor' && <SurveyMonitor />}
          {activeTab === 'farmers' && <FarmerTracker />}
          {activeTab === 'analytics' && <AnalyticsDashboard />}
          {activeTab === 'chat' && <AIChatPanel />}
          {activeTab === 'editor' && <QuestionsEditor />}
          {/* {activeTab === 'recorder' && <SurveyAudioRecorder />} */}
        </main>
      </div>

      <footer className="app-footer">
        <p>Phase 1: Core Survey Flow | Backend: Node.js + Express | Database: MongoDB | AI: Groq</p>
      </footer>

      {requiresSurveyName && (
        <div className="survey-name-modal-overlay">
          <form className="survey-name-modal-card" onSubmit={submitSurveyName}>
            <h2>Name your survey</h2>
            <p>Enter the name of the survey you are conducting to continue.</p>

            <div className="form-group">
              <label htmlFor="surveyName">Survey Name</label>
              <input
                id="surveyName"
                type="text"
                value={surveyName}
                onChange={(e) => setSurveyName(e.target.value)}
                placeholder="e.g. Kharif Season Baseline 2026"
                autoFocus
              />
            </div>

            {surveyNameError && <div className="error">{surveyNameError}</div>}

            <div className="survey-name-modal-actions">
              <button type="submit" disabled={surveyNameBusy}>
                {surveyNameBusy ? 'Saving...' : 'Save Survey Name'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;
