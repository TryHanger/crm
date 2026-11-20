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
    <div className="auth">
      <div className="card">
        <div className="logo">CRM</div>
        <h1>Вход в CRM</h1>
        <div className="sub">Введите учётные данные сотрудника компании</div>

        {error && (
          <div role="alert" className="err">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label className="f">Email сотрудника</label>
          <input
            className="inp"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="owner@barberhouse.kz"
            data-testid="crm-login-email-input"
            autoComplete="username"
            required
          />
          <label className="f">Пароль</label>
          <input
            className="inp"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            data-testid="crm-login-password-input"
            autoComplete="current-password"
            required
          />
          <button
            type="submit"
            className="btn p"
            data-testid="crm-login-submit-btn"
            disabled={isLoading}
            style={{ opacity: isLoading ? 0.7 : 1 }}
          >
            {isLoading ? 'Авторизация…' : 'Войти в панель'}
          </button>
        </form>
      </div>
    </div>
  );
};
