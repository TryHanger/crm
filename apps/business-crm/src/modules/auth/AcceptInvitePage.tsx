import React, { useState } from 'react';
import { BusinessCrmApiClient } from '@crm/api-client';
import { CrmMembership } from '../../types';

interface AcceptInvitePageProps {
  api: BusinessCrmApiClient;
  token: string;
  onSuccess: (token: string, memberships: CrmMembership[], user: any) => void;
}

export const AcceptInvitePage: React.FC<AcceptInvitePageProps> = ({ api, token, onSuccess }) => {
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Введите пароль для учетной записи');
      return;
    }
    if (password.length < 8) {
      setError('Пароль должен содержать минимум 8 символов');
      return;
    }
    if (password !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const res = await api.acceptInvite({
        token,
        password,
        full_name: fullName.trim() || undefined,
      });

      const me = await api.getMe(res.access_token);
      const mems: CrmMembership[] = me.crm_memberships || [];
      setIsSuccess(true);
      setTimeout(() => {
        onSuccess(res.access_token, mems, me);
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Ошибка при активации приглашения. Возможно, ссылка устарела или уже была использована.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      data-testid="accept-invite-page"
      style={{
        minHeight: '100vh',
        background: '#0F172A',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          background: '#FFFFFF',
          borderRadius: '20px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
          padding: '36px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: '#2563EB',
              color: '#FFFFFF',
              margin: '0 auto 8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              fontWeight: 700,
            }}
          >
            ✓
          </div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#0F172A' }}>
            Активация доступа в CRM
          </h1>
          <p style={{ margin: 0, fontSize: '14px', color: '#64748B' }}>
            Задайте пароль для входа в панель управления компанией
          </p>
        </div>

        {error && (
          <div
            role="alert"
            data-testid="accept-invite-error"
            style={{
              background: '#FEE2E2',
              color: '#991B1B',
              padding: '12px 16px',
              borderRadius: '10px',
              fontSize: '14px',
              border: '1px solid #FCA5A5',
            }}
          >
            {error}
          </div>
        )}

        {isSuccess ? (
          <div
            data-testid="accept-invite-success"
            style={{
              background: '#ECFDF5',
              color: '#065F46',
              padding: '16px',
              borderRadius: '10px',
              fontSize: '15px',
              textAlign: 'center',
              fontWeight: 600,
            }}
          >
            Доступ успешно активирован! Перенаправление в панель...
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '14px', fontWeight: 500, color: '#334155' }}>
                Ваше имя
              </label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Иван Петров"
                data-testid="invite-name-input"
                style={{
                  height: '44px',
                  padding: '0 14px',
                  borderRadius: '10px',
                  border: '1px solid #CBD5E1',
                  fontSize: '15px',
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '14px', fontWeight: 500, color: '#334155' }}>
                Новый пароль
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Минимум 8 символов"
                data-testid="invite-password-input"
                required
                style={{
                  height: '44px',
                  padding: '0 14px',
                  borderRadius: '10px',
                  border: '1px solid #CBD5E1',
                  fontSize: '15px',
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '14px', fontWeight: 500, color: '#334155' }}>
                Подтверждение пароля
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Повторите пароль"
                data-testid="invite-confirm-password-input"
                required
                style={{
                  height: '44px',
                  padding: '0 14px',
                  borderRadius: '10px',
                  border: '1px solid #CBD5E1',
                  fontSize: '15px',
                  outline: 'none',
                }}
              />
            </div>

            <button
              type="submit"
              data-testid="invite-submit-btn"
              disabled={isLoading}
              style={{
                height: '46px',
                marginTop: '8px',
                borderRadius: '10px',
                background: '#2563EB',
                color: '#FFFFFF',
                border: 'none',
                fontSize: '15px',
                fontWeight: 600,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.7 : 1,
              }}
            >
              {isLoading ? 'Активация...' : 'Активировать доступ'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
