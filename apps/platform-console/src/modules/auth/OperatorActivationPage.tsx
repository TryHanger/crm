import React, { useState, useEffect } from 'react';
import { PlatformApiClient } from '@crm/api-client';

interface OperatorActivationPageProps {
  api: PlatformApiClient;
  onNavigateToLogin: () => void;
  showToast?: (msg: string) => void;
}

export const OperatorActivationPage: React.FC<OperatorActivationPageProps> = ({
  api,
  onNavigateToLogin,
  showToast,
}) => {
  const [token, setToken] = useState<string>('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [isExistingCrmUser, setIsExistingCrmUser] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tok = params.get('token');
    if (tok) {
      setToken(tok);
    } else {
      setError('Токен активации отсутствует в ссылке или ссылка повреждена.');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError('Токен активации отсутствует.');
      return;
    }

    if (!isExistingCrmUser) {
      if (!password || password.length < 8) {
        setError('Пароль должен содержать минимум 8 символов.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Пароли не совпадают.');
        return;
      }
    } else {
      if (!currentPassword) {
        setError('Для действующего пользователя CRM введите ваш текущий пароль для подтверждения.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await api.activateStaff({
        activation_token: token,
        password: isExistingCrmUser ? undefined : password,
        current_password: isExistingCrmUser ? currentPassword : undefined,
      });

      setIsSuccess(true);
      if (showToast) {
        showToast('Учётная запись успешно активирована!');
      }

      // Security: Clean sensitive token from URL query string
      window.history.replaceState({}, '', '/activate-platform');
    } catch (err: any) {
      setError(err.message || 'Ошибка активации учётной записи. Токен мог истечь или уже был использован.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      data-testid="operator-activation-page"
      style={{
        minHeight: '100vh',
        background: '#0B1220',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        boxSizing: 'border-box',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        data-testid="operator-activation-card"
        style={{
          background: '#0F172A',
          border: '1px solid #1E293B',
          borderRadius: '16px',
          padding: '36px 32px',
          maxWidth: '440px',
          width: '100%',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          boxSizing: 'border-box',
        }}
      >
        {/* LOGO & TITLE */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '10px',
              background: '#2563EB',
              color: '#FFFFFF',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              fontWeight: 800,
              marginBottom: '12px',
            }}
          >
            PC
          </div>
          <h1 style={{ margin: '0 0 6px 0', fontSize: '20px', fontWeight: 700, color: '#FFFFFF' }}>
            Активация доступа к Platform Console
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94A3B8' }}>
            {isSuccess
              ? 'Активация завершена'
              : 'Установите пароль для входа в панель управления SaaS'}
          </p>
        </div>

        {/* SUCCESS VIEW */}
        {isSuccess ? (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div
              data-testid="activation-success"
              style={{
                background: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid #16A34A',
                borderRadius: '8px',
                padding: '16px',
                color: '#86EFAC',
                fontSize: '14px',
                lineHeight: 1.5,
              }}
            >
              🎉 Учётная запись оператора платформы успешно активирована! Теперь вы можете войти в систему.
            </div>

            <button
              onClick={onNavigateToLogin}
              data-testid="go-to-login-btn"
              style={{
                width: '100%',
                padding: '12px',
                background: '#2563EB',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Перейти ко входу в консоль →
            </button>
          </div>
        ) : (
          /* ACTIVATION FORM */
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {error && (
              <div
                data-testid="activation-error"
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid #DC2626',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  color: '#FCA5A5',
                  fontSize: '13px',
                  lineHeight: 1.4,
                }}
              >
                {error}
              </div>
            )}

            {/* Toggle if already has CRM user */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                color: '#94A3B8',
                cursor: 'pointer',
                marginBottom: '4px',
              }}
            >
              <input
                type="checkbox"
                checked={isExistingCrmUser}
                onChange={e => {
                  setIsExistingCrmUser(e.target.checked);
                  setError(null);
                }}
                data-testid="existing-crm-user-toggle"
              />
              Я уже являюсь пользователем Business CRM (повышение роли)
            </label>

            {isExistingCrmUser ? (
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
                  Текущий пароль учётной записи CRM:
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder="Введите ваш действующий пароль"
                  required
                  data-testid="activation-current-password-input"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    background: '#1E293B',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#FFFFFF',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
                <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>
                  Ваш существующий пароль останется неизменным и подтвердит ваше согласие на платформенную роль.
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
                    Новый пароль оператора:
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Минимум 8 символов"
                    minLength={8}
                    required
                    data-testid="activation-password-input"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: '#1E293B',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      color: '#FFFFFF',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
                    Повторите новый пароль:
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Повторите пароль"
                    minLength={8}
                    required
                    data-testid="activation-confirm-password-input"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: '#1E293B',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      color: '#FFFFFF',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !token}
              data-testid="activation-submit-btn"
              style={{
                width: '100%',
                padding: '12px',
                background: isSubmitting ? '#1D4ED8' : '#2563EB',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                marginTop: '8px',
              }}
            >
              {isSubmitting ? 'Активация...' : 'Активировать учётную запись'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '12px' }}>
              <button
                type="button"
                onClick={onNavigateToLogin}
                data-testid="back-to-login-link"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94A3B8',
                  fontSize: '12px',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Вернуться на страницу входа
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
