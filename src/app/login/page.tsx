// src/app/login/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setErrorMsg('נא להזין סיסמה');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        // Redirect to dashboard on successful login
        router.push('/');
        router.refresh();
      } else {
        setErrorMsg(data.error || 'התחברות נכשלה. אנא נסה שוב.');
      }
    } catch {
      setErrorMsg('שגיאת תקשורת עם השרת. אנא נסה שוב מאוחר יותר.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      {/* Dynamic Style Override to hide Sidebar and reset margins */}
      <style dangerouslySetInnerHTML={{ __html: `
        .sidebar {
          display: none !important;
        }
        .main-content {
          margin-right: 0 !important;
          padding: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
        }
      ` }} />

      <div className="login-card">
        <div className="login-brand">
          <span className="login-brand-icon">🛍️</span>
          <h1 className="gradient-text login-brand-title">AliExpress Bot</h1>
        </div>

        <h2 className="login-subtitle">כניסת מנהל מערכת</h2>
        <p className="login-desc">אנא הזן את סיסמת הניהול שלך כדי לגשת ללוח הבקרה.</p>

        {errorMsg && (
          <div className="login-error">
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label className="form-label" style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>סיסמת מנהל</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoFocus
              disabled={isLoading}
            />
          </div>

          <button
            type="submit"
            className={`btn btn-primary login-btn ${isLoading ? 'btn-disabled' : ''}`}
            disabled={isLoading}
          >
            {isLoading ? 'מתחבר...' : 'התחבר למערכת'}
          </button>
        </form>
      </div>

      <style jsx>{`
        .login-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          min-height: 100vh;
          background: radial-gradient(circle at center, #0f172a 0%, #020617 100%);
          padding: 1.5rem;
        }

        .login-card {
          width: 100%;
          max-width: 440px;
          background: rgba(15, 22, 36, 0.7);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          padding: 3rem 2.5rem;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4), 0 0 40px rgba(0, 210, 255, 0.03);
          text-align: center;
          animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .login-brand {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          margin-bottom: 1.5rem;
        }

        .login-brand-icon {
          font-size: 2.2rem;
        }

        .login-brand-title {
          font-size: 2.4rem;
          font-weight: 800;
          font-family: var(--font-display);
          letter-spacing: -0.02em;
        }

        .login-subtitle {
          font-size: 1.25rem;
          color: var(--text-primary);
          font-weight: 600;
          margin-bottom: 0.5rem;
        }

        .login-desc {
          font-size: 0.9rem;
          color: var(--text-secondary);
          margin-bottom: 2rem;
          line-height: 1.5;
        }

        .login-error {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background: rgba(244, 63, 94, 0.1);
          border: 1px solid rgba(244, 63, 94, 0.2);
          color: #f87171;
          padding: 0.75rem 1rem;
          border-radius: 8px;
          margin-bottom: 1.5rem;
          font-size: 0.875rem;
          text-align: right;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .login-btn {
          width: 100%;
          padding: 0.85rem;
          font-size: 1rem;
          font-weight: 600;
          margin-top: 0.5rem;
          background: var(--primary-gradient);
          border: none;
          box-shadow: var(--shadow-glow);
          transition: all 0.3s ease;
        }

        .login-btn:hover:not(.btn-disabled) {
          transform: translateY(-2px);
          box-shadow: 0 0 20px rgba(0, 210, 255, 0.4);
        }

        .login-btn:active:not(.btn-disabled) {
          transform: translateY(0);
        }
      `}</style>
    </div>
  );
}
