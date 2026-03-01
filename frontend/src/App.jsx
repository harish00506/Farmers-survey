import { useState, useEffect } from 'react';
import './App.css';
import SurveyMonitor from './components/SurveyMonitor';
import FarmerTracker from './components/FarmerTracker';
import FarmersDatabaseTab from './components/FarmersDatabaseTab';
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

function AppIcon({ name, className = '' }) {
  const common = {
    fill: 'none',
    viewBox: '0 0 24 24',
    strokeWidth: 1.8,
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: `app-icon ${className}`.trim(),
    'aria-hidden': 'true',
  };

  if (name === 'menu') {
    return (
      <svg {...common}>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    );
  }

  if (name === 'brand') {
    return (
      <svg {...common}>
        <path d="M12 3v18" />
        <path d="M6 8c3-2 9-2 12 0-3 2-9 2-12 0Z" />
        <path d="M5 14c2.5-1.5 11.5-1.5 14 0-2.5 1.5-11.5 1.5-14 0Z" />
      </svg>
    );
  }

  if (name === 'monitor') {
    return (
      <svg {...common}>
        <path d="M4 4h16v13H4z" />
        <path d="m8 13 2.5-2.5 2 2 3.5-4" />
        <path d="M10 20h4" />
      </svg>
    );
  }

  if (name === 'users') {
    return (
      <svg {...common}>
        <path d="M16 21v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" />
        <circle cx="9.5" cy="8" r="3" />
        <path d="M22 21v-1a4 4 0 0 0-3-3.87" />
        <path d="M16 4.13a3 3 0 0 1 0 5.74" />
      </svg>
    );
  }

  if (name === 'database') {
    return (
      <svg {...common}>
        <ellipse cx="12" cy="5" rx="7" ry="3" />
        <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
        <path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
      </svg>
    );
  }

  if (name === 'reports') {
    return (
      <svg {...common}>
        <path d="M4 20h16" />
        <path d="M7 16V9" />
        <path d="M12 16V5" />
        <path d="M17 16v-4" />
      </svg>
    );
  }

  if (name === 'ai') {
    return (
      <svg {...common}>
        <rect x="7" y="7" width="10" height="10" rx="2" />
        <path d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3" />
      </svg>
    );
  }

  if (name === 'edit') {
    return (
      <svg {...common}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" />
      </svg>
    );
  }

  if (name === 'logout') {
    return (
      <svg {...common}>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5" />
        <path d="M21 12H9" />
      </svg>
    );
  }

  if (name === 'delete') {
    return (
      <svg {...common}>
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="M19 6l-1 14H6L5 6" />
        <path d="M10 11v6M14 11v6" />
      </svg>
    );
  }

  if (name === 'user') {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
    );
  }

  return null;
}

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
  const navItems = [
    {
      id: 'monitor',
      icon: 'monitor',
      title: 'Survey Status',
      description: 'Track live responses',
    },
    {
      id: 'farmers',
      icon: 'users',
      title: 'Send Surveys',
      description: 'Target and invite farmers',
    },
    {
      id: 'farmers-db',
      icon: 'database',
      title: 'Farmer List',
      description: 'View all farmer records',
    },
    {
      id: 'analytics',
      icon: 'reports',
      title: 'Reports',
      description: 'See trends and outcomes',
    },
    {
      id: 'chat',
      icon: 'ai',
      title: 'Ask AI',
      description: 'Ask questions about data',
    },
    {
      id: 'editor',
      icon: 'edit',
      title: 'Survey Setup',
      description: 'Manage questions and flow',
    },
  ];

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
            <span className="auth-badge"><AppIcon name="brand" className="auth-badge-icon" /> Survey Platform</span>
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
          <button className="hamburger" onClick={() => setSidebarOpen((s) => !s)} aria-label="Toggle navigation">
            <AppIcon name="menu" />
          </button>
          <div className="brand-block">
            <span className="brand-icon" aria-hidden="true">
              <AppIcon name="brand" />
            </span>
            <div className="brand-text">
              <h1>{activeSurveyName || 'Survey Analytics'}</h1>
              <p className="subtitle">AI-enabled WhatsApp survey management platform</p>
            </div>
          </div>
        </div>
        <div className="header-right">
          <ThemeToggle />
          <span className="user-chip"><AppIcon name="user" /> <span>{currentUser?.email}</span></span>
          <button type="button" className="header-action-btn" onClick={logout}>
            <AppIcon name="logout" />
            <span>Logout</span>
          </button>
          {/* <button type="button" className="btn-danger header-action-btn" onClick={deleteAccount} disabled={deleteAccountBusy}>
            <AppIcon name="delete" />
            {deleteAccountBusy ? 'Deleting...' : 'Delete Account'}
          </button> */}
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
          <nav className="sidebar-nav" aria-label="Main navigation">
            <p className="nav-section-title">Main Menu</p>
            {navItems.map((item) => (
              <button
                key={item.id}
                className={`nav-link ${activeTab === item.id ? 'active' : ''}`}
                onClick={() => setActiveTab(item.id)}
              >
                <span className="nav-link-icon" aria-hidden="true"><AppIcon name={item.icon} /></span>
                <span className="nav-link-text">
                  <span className="label nav-link-title">{item.title}</span>
                  <span className="nav-link-description">{item.description}</span>
                </span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="app-main">
          {activeTab === 'monitor' && <SurveyMonitor />}
          {activeTab === 'farmers' && <FarmerTracker />}
          {activeTab === 'farmers-db' && <FarmersDatabaseTab />}
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
