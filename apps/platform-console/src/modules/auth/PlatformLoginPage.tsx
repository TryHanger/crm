import React, { useState } from 'react';
import { PlatformApiClient } from '@crm/api-client';

interface PlatformLoginPageProps {
  api: PlatformApiClient;
  onLoginSuccess: (token: string, user: any) => void;
}

export const PlatformLoginPage: React.FC<PlatformLoginPageProps> = ({ api, onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Введите email и пароль');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const tokenRes = await api.login({ email, password });
      const meRes = await api.getMe(tokenRes.access_token);

      // Verify that user is platform staff
      if (!meRes.platform_role) {
        setError('У этой учётной записи нет прав доступа к Platform Console. Используйте аккаунт сотрудника платформы.');
        setIsLoading(false);
        return;
      }

      onLoginSuccess(tokenRes.access_token, meRes);
    } catch (err: any) {
      setError(err.message || 'Ошибка входа. Проверьте правильность email и пароля.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickLogin = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('Password123!');
    setError(null);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0B1220',
        padding: '20px',
        color: '#F8FAFC',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          background: '#1E293B',
          borderRadius: '16px',
          padding: '36px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
          border: '1px solid #334155',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '54px',
              height: '54px',
              borderRadius: '14px',
              background: '#2563EB',
              color: '#FFFFFF',
              fontWeight: 800,
              fontSize: '22px',
              marginBottom: '16px',
            }}
          >
            PC
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 6px 0', color: '#FFFFFF' }}>Platform Console</h1>
          <div style={{ display: 'inline-block', marginBottom: '8px' }}>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#EF4444',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '6px',
                padding: '2px 8px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Внутренний доступ
            </span>
          </div>
          <p style={{ fontSize: '13px', color: '#94A3B8', margin: 0 }}>
            Управление инфраструктурой, компаниями, биллингом и тарифами SaaS
          </p>
        </div>

        {error && (
          <div
            data-testid="login-error-message"
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#FCA5A5',
              padding: '12px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              marginBottom: '20px',
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#CBD5E1', marginBottom: '6px' }}>
              Email оператора
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="operator@platform.example.kz"
              required
              data-testid="platform-login-email-input"
              style={{
                width: '100%',
                padding: '10px 14px',
                background: '#0F172A',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#FFFFFF',
                fontSize: '14px',
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#CBD5E1', marginBottom: '6px' }}>
              Пароль
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              data-testid="platform-login-password-input"
              style={{
                width: '100%',
                padding: '10px 14px',
                background: '#0F172A',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#FFFFFF',
                fontSize: '14px',
                outline: 'none',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            data-testid="platform-login-submit-btn"
            style={{
              marginTop: '8px',
              padding: '12px',
              background: '#2563EB',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.7 : 1,
              transition: 'background 0.15s ease',
            }}
          >
            {isLoading ? 'Авторизация...' : 'Войти в Platform Console'}
          </button>
        </form>

        <div style={{ marginTop: '28px', borderTop: '1px solid #334155', paddingTop: '20px' }}>
          <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '10px', textAlign: 'center' }}>
            Быстрый вход для тестирования:
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button
              type="button"
              onClick={() => handleQuickLogin('owner@platform.example.kz')}
              data-testid="quick-login-owner"
              style={{
                padding: '8px 10px',
                background: '#0F172A',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#E2E8F0',
                fontSize: '12px',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              👑 <b>Владелец</b>
              <div style={{ fontSize: '10px', color: '#94A3B8' }}>owner@...</div>
            </button>

            <button
              type="button"
              onClick={() => handleQuickLogin('support@platform.example.kz')}
              data-testid="quick-login-support"
              style={{
                padding: '8px 10px',
                background: '#0F172A',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#E2E8F0',
                fontSize: '12px',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              🛠️ <b>Поддержка</b>
              <div style={{ fontSize: '10px', color: '#94A3B8' }}>support@...</div>
            </button>

            <button
              type="button"
              onClick={() => handleQuickLogin('finance@platform.example.kz')}
              data-testid="quick-login-finance"
              style={{
                padding: '8px 10px',
                background: '#0F172A',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#E2E8F0',
                fontSize: '12px',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              💳 <b>Финансы</b>
              <div style={{ fontSize: '10px', color: '#94A3B8' }}>finance@...</div>
            </button>

            <button
              type="button"
              onClick={() => handleQuickLogin('viewer@platform.example.kz')}
              data-testid="quick-login-viewer"
              style={{
                padding: '8px 10px',
                background: '#0F172A',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#E2E8F0',
                fontSize: '12px',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              👁️ <b>Наблюдатель</b>
              <div style={{ fontSize: '10px', color: '#94A3B8' }}>viewer@...</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
