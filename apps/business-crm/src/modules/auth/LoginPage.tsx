import React, { useState } from 'react';
import { BusinessCrmApiClient } from '@crm/api-client';
import { CrmMembership } from '../../types';

interface LoginPageProps {
  api: BusinessCrmApiClient;
  onSuccess: (token: string, memberships: CrmMembership[], user: any) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ api, onSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Введите email и пароль');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const res = await api.login({
        email: email.trim(),
        password: password,
      });

      const me = await api.getMe(res.access_token);
      const mems: CrmMembership[] = me.crm_memberships || [];
      if (mems.length === 0) {
        setError('У вас нет активного членства ни в одной компании CRM');
        return;
      }

      onSuccess(res.access_token, mems, me);
    } catch (err: any) {
      setError(err.message || 'Неверный email или пароль');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
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
          maxWidth: '420px',
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
              background: '#0F172A',
              color: '#FFFFFF',
              margin: '0 auto 8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              fontWeight: 700,
            }}
          >
            BH
          </div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0F172A' }}>
            Вход в CRM
          </h1>
          <p style={{ margin: 0, fontSize: '14px', color: '#64748B' }}>
            Введите учетные данные сотрудника компании
          </p>
        </div>

        {error && (
          <div
            role="alert"
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

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '14px', fontWeight: 500, color: '#334155' }}>
              Email сотрудника
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="owner@barberhouse.kz"
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
            <label style={{ fontSize: '14px', fontWeight: 500, color: '#334155' }}>Пароль</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
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
            {isLoading ? 'Авторизация…' : 'Войти в панель'}
          </button>
        </form>
      </div>
    </div>
  );
};
