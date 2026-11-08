import React, { useState, useEffect, useCallback } from 'react';
import { BusinessCrmApiClient } from '@crm/api-client';

interface CrmMembership {
  membership_id: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  role: string;
}

interface CalendarStaff {
  id: string;
  name: string;
  role_title?: string;
  color?: string;
}

interface CalendarBooking {
  id: string;
  public_ref: string;
  staff_id: string;
  customer_name: string;
  customer_phone: string;
  status: string;
  starts_at_utc: string;
  service_ends_at_utc: string;
  amount_minor: number;
  services: string[];
}

export const App: React.FC = () => {
  const [api] = useState(() => new BusinessCrmApiClient());

  // Authentication State
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('crm_token') || null);
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [memberships, setMemberships] = useState<CrmMembership[]>([]);
  const [activeMembership, setActiveMembership] = useState<CrmMembership | null>(null);

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Business CRM Workspace State
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [staffList, setStaffList] = useState<CalendarStaff[]>([]);
  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<CalendarBooking | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Load Current User and Active Memberships
  const loadUserContext = useCallback(async (authToken: string) => {
    try {
      setIsLoading(true);
      const me = await api.getMe(authToken);
      setCurrentUser(me);

      const mems: CrmMembership[] = me.crm_memberships || [];
      setMemberships(mems);

      if (mems.length > 0) {
        // Retain current tenant or pick first
        setActiveMembership(prev => {
          if (prev && mems.some(m => m.tenant_id === prev.tenant_id)) {
            return prev;
          }
          return mems[0];
        });
      } else {
        setActiveMembership(null);
      }
    } catch (err: any) {
      console.error('Failed to load user context', err);
      // If token expired, clear
      setToken(null);
      localStorage.removeItem('crm_token');
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (token) {
      loadUserContext(token);
    }
  }, [token, loadUserContext]);

  // Fetch branches when activeMembership changes
  useEffect(() => {
    if (!token || !activeMembership) return;

    const fetchBranches = async () => {
      try {
        const branchRes = await fetch('/api/v1/business/branches', {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Tenant-ID': activeMembership.tenant_id,
          },
        });
        if (branchRes.ok) {
          const brs = await branchRes.json();
          setBranches(brs);
          if (brs.length > 0) {
            setSelectedBranchId(brs[0].id);
          } else {
            setSelectedBranchId(null);
          }
        }
      } catch (err) {
        console.error('Failed to fetch branches', err);
      }
    };

    fetchBranches();
  }, [token, activeMembership]);

  // Fetch Calendar Data
  const fetchCalendar = useCallback(async () => {
    if (!token || !activeMembership || !selectedBranchId) return;

    try {
      setIsLoading(true);
      const data = await api.getCalendar(
        {
          date: currentDate,
          branch_id: selectedBranchId,
        },
        token,
        activeMembership.tenant_id
      );

      const mappedStaff: CalendarStaff[] = (data.masters || []).map((m: any) => ({
        id: m.staff_id,
        name: m.name,
        role_title: m.role_title,
        color: m.color || '#3B82F6',
      }));
      setStaffList(mappedStaff);

      const mappedBookings: CalendarBooking[] = (data.appointments || []).map((a: any) => ({
        id: a.booking_id,
        public_ref: a.public_ref,
        staff_id: a.staff_id,
        customer_name: a.customer_name,
        customer_phone: a.customer_phone,
        status: a.status,
        starts_at_utc: a.starts_at_utc,
        service_ends_at_utc: a.service_ends_at_utc,
        amount_minor: a.amount_minor,
        services: a.services || [],
      }));
      setBookings(mappedBookings);
    } catch (err: any) {
      console.error('Failed to load calendar', err);
      setBookings([]);
    } finally {
      setIsLoading(false);
    }
  }, [api, token, activeMembership, selectedBranchId, currentDate]);

  useEffect(() => {
    fetchCalendar();
  }, [fetchCalendar]);

  // Handle Login Submit
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setLoginError('Введите email и пароль');
      return;
    }

    try {
      setIsLoggingIn(true);
      setLoginError(null);
      const res = await api.login({
        email: loginEmail.trim(),
        password: loginPassword,
      });

      setToken(res.access_token);
      localStorage.setItem('crm_token', res.access_token);
      await loadUserContext(res.access_token);
    } catch (err: any) {
      setLoginError(err.message || 'Неверный email или пароль');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Handle Logout
  const handleLogout = () => {
    setToken(null);
    setCurrentUser(null);
    setMemberships([]);
    setActiveMembership(null);
    setBookings([]);
    localStorage.removeItem('crm_token');
  };

  // Handle Status Update (PATCH /business/bookings/{id}/status)
  const handleUpdateStatus = async (targetStatus: string) => {
    if (!token || !activeMembership || !selectedBooking) return;

    try {
      setStatusUpdating(true);
      const updated = await api.updateBookingStatus(
        selectedBooking.id,
        { status: targetStatus },
        token,
        activeMembership.tenant_id
      );

      // Update in state
      setSelectedBooking(prev => (prev ? { ...prev, status: updated.status } : null));
      setBookings(prev =>
        prev.map(b => (b.id === selectedBooking.id ? { ...b, status: updated.status } : b))
      );

      setToastMessage(`Статус записи обновлен на «${targetStatus}»`);
      setTimeout(() => setToastMessage(null), 3500);
      setSelectedBooking(null);
    } catch (err: any) {
      alert(`Ошибка обновления статуса: ${err.message || err}`);
    } finally {
      setStatusUpdating(false);
    }
  };

  // Helper styles & status colors
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed':
        return { bg: '#DCFCE7', border: '#86EFAC', text: '#166534', label: 'Подтверждена' };
      case 'arrived':
        return { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E', label: 'Прибыл' };
      case 'in_progress':
        return { bg: '#DBEAFE', border: '#93C5FD', text: '#1E40AF', label: 'В работе' };
      case 'completed':
        return { bg: '#F1F5F9', border: '#CBD5E1', text: '#475569', label: 'Завершен' };
      case 'cancelled':
        return { bg: '#FEE2E2', border: '#FCA5A5', text: '#991B1B', label: 'Отменен' };
      default:
        return { bg: '#F1F5F9', border: '#E2E8F0', text: '#0F172A', label: status };
    }
  };

  // Hours displayed on the calendar (09:00 - 20:00)
  const hours = Array.from({ length: 12 }, (_, i) => i + 9);

  // 1. Render Login Screen if not authenticated
  if (!token || !activeMembership) {
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
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px',
                fontWeight: 800,
                margin: '0 auto 8px',
              }}
            >
              C
            </div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 800, color: '#0F172A' }}>Вход в CRM</h1>
            <p style={{ margin: 0, fontSize: '14px', color: '#64748B' }}>
              Панель управления записями компании
            </p>
          </div>

          {loginError && (
            <div
              role="alert"
              style={{
                padding: '12px 16px',
                borderRadius: '10px',
                background: '#FEF2F2',
                border: '1px solid #FCA5A5',
                color: '#991B1B',
                fontSize: '14px',
              }}
            >
              {loginError}
            </div>
          )}

          {token && memberships.length === 0 && (
            <div
              role="alert"
              style={{
                padding: '12px 16px',
                borderRadius: '10px',
                background: '#FEF3C7',
                border: '1px solid #FCD34D',
                color: '#92400E',
                fontSize: '14px',
              }}
            >
              У вашей учетной записи нет активных членств в организациях.
            </div>
          )}

          <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Электронная почта</label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                placeholder="owner@barberhouse.kz"
                style={{
                  height: '46px',
                  padding: '0 14px',
                  borderRadius: '10px',
                  border: '1px solid #CBD5E1',
                  fontSize: '15px',
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Пароль</label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                placeholder="••••••••••••"
                style={{
                  height: '46px',
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
              disabled={isLoggingIn}
              style={{
                height: '48px',
                borderRadius: '12px',
                border: 0,
                background: '#0F172A',
                color: '#FFFFFF',
                fontSize: '16px',
                fontWeight: 600,
                cursor: isLoggingIn ? 'not-allowed' : 'pointer',
                marginTop: '8px',
                transition: 'background 0.15s ease',
              }}
            >
              {isLoggingIn ? 'Авторизация…' : 'Войти в систему'}
            </button>
          </form>

          {token && (
            <button
              type="button"
              onClick={handleLogout}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748B',
                fontSize: '13px',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              Сменить пользователя
            </button>
          )}
        </div>
      </div>
    );
  }

  // 2. Main Authenticated CRM Calendar Dashboard
  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', display: 'flex', flexDirection: 'column' }}>
      {/* CRM Header with Organization Switcher */}
      <header
        style={{
          background: '#FFFFFF',
          borderBottom: '1px solid #E2E8F0',
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: '#0F172A',
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '16px',
              }}
            >
              CRM
            </div>
            <div>
              <span
                style={{
                  fontSize: '17px',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: '#0F172A',
                }}
              >
                {activeMembership.tenant_name} CRM
              </span>
              <div style={{ fontSize: '12px', color: '#64748B' }}>Роль: {activeMembership.role}</div>
            </div>
          </div>

          {/* Authorized Organizations Switcher */}
          {memberships.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', color: '#64748B' }}>Организация:</span>
              <select
                value={activeMembership.tenant_id}
                onChange={e => {
                  const m = memberships.find(x => x.tenant_id === e.target.value);
                  if (m) setActiveMembership(m);
                }}
                style={{
                  height: '34px',
                  padding: '0 10px',
                  borderRadius: '8px',
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#0F172A',
                }}
              >
                {memberships.map(m => (
                  <option key={m.tenant_id} value={m.tenant_id}>
                    {m.tenant_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Branch Selector */}
          {branches.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', color: '#64748B' }}>Филиал:</span>
              <select
                value={selectedBranchId || ''}
                onChange={e => setSelectedBranchId(e.target.value)}
                style={{
                  height: '34px',
                  padding: '0 10px',
                  borderRadius: '8px',
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  fontSize: '13px',
                  color: '#0F172A',
                }}
              >
                {branches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* User Info & Logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '14px', color: '#334155', fontWeight: 500 }}>
            {currentUser?.display_name || currentUser?.email}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              color: '#64748B',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Выйти
          </button>
        </div>
      </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          style={{
            position: 'fixed',
            top: '20px',
            right: '24px',
            zIndex: 100,
            padding: '12px 20px',
            borderRadius: '12px',
            background: '#15803D',
            color: '#FFFFFF',
            fontWeight: 600,
            fontSize: '14px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {/* Top Controls: Date & Status Summary */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 800, color: '#0F172A' }}>
              Календарь записей
            </h1>
            <input
              type="date"
              value={currentDate}
              onChange={e => setCurrentDate(e.target.value)}
              style={{
                height: '38px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                fontSize: '14px',
                fontWeight: 600,
                color: '#0F172A',
              }}
            />
            <button
              type="button"
              onClick={fetchCalendar}
              style={{
                height: '38px',
                padding: '0 14px',
                borderRadius: '8px',
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Обновить
            </button>
          </div>

          <div style={{ fontSize: '14px', color: '#64748B' }}>
            Всего записей на дату: <strong>{bookings.length}</strong>
          </div>
        </div>

        {/* Day Calendar Grid by Staff */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: '16px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
            overflowX: 'auto',
          }}
        >
          {staffList.length === 0 ? (
            <div style={{ padding: '60px 24px', textAlign: 'center', color: '#64748B' }}>
              {isLoading ? 'Загрузка расписания мастеров…' : 'В выбранном филиале нет активных мастеров.'}
            </div>
          ) : (
            <div style={{ minWidth: `${Math.max(600, (staffList.length + 1) * 200)}px` }}>
              {/* Header Row: Staff Names */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `80px repeat(${staffList.length}, 1fr)`,
                  borderBottom: '1px solid #E2E8F0',
                  background: '#F8FAFC',
                }}
              >
                <div style={{ padding: '14px', fontSize: '13px', fontWeight: 600, color: '#64748B' }}>Время</div>
                {staffList.map(st => (
                  <div
                    key={st.id}
                    style={{
                      padding: '12px 16px',
                      borderLeft: '1px solid #E2E8F0',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                    }}
                  >
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: st.color || '#3B82F6',
                        color: '#FFFFFF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '13px',
                        fontWeight: 700,
                      }}
                    >
                      {st.name.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>{st.name}</div>
                      <div style={{ fontSize: '12px', color: '#64748B' }}>{st.role_title || 'Мастер'}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Hours Rows */}
              {hours.map(hour => {
                const hourLabel = `${hour.toString().padStart(2, '0')}:00`;

                return (
                  <div
                    key={hour}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `80px repeat(${staffList.length}, 1fr)`,
                      borderBottom: '1px solid #F1F5F9',
                      minHeight: '74px',
                    }}
                  >
                    {/* Time Label */}
                    <div
                      style={{
                        padding: '8px 12px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#94A3B8',
                        background: '#FAFAFA',
                        borderRight: '1px solid #F1F5F9',
                      }}
                    >
                      {hourLabel}
                    </div>

                    {/* Master Slot Cells */}
                    {staffList.map(st => {
                      // Find bookings starting within this hour for this master
                      const cellBookings = bookings.filter(b => {
                        if (b.staff_id !== st.id) return false;
                        const startD = new Date(b.starts_at_utc);
                        // Convert to branch timezone or local hour
                        const almatyHour = (startD.getUTCHours() + 5) % 24;
                        return almatyHour === hour;
                      });

                      return (
                        <div
                          key={st.id}
                          style={{
                            padding: '6px 8px',
                            borderLeft: '1px solid #F1F5F9',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                            background: '#FFFFFF',
                          }}
                        >
                          {cellBookings.map(b => {
                            const badge = getStatusColor(b.status);
                            const startD = new Date(b.starts_at_utc);
                            const timeStr = startD.toLocaleTimeString('ru-RU', {
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'Asia/Almaty',
                            });

                            return (
                              <div
                                key={b.id}
                                onClick={() => setSelectedBooking(b)}
                                style={{
                                  padding: '8px 10px',
                                  borderRadius: '8px',
                                  background: badge.bg,
                                  border: `1px solid ${badge.border}`,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '2px',
                                  transition: 'transform 0.1s ease',
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontSize: '11px', fontWeight: 700, color: badge.text }}>
                                    {timeStr} · #{b.public_ref}
                                  </span>
                                  <span style={{ fontSize: '10px', fontWeight: 600, color: badge.text }}>
                                    {badge.label}
                                  </span>
                                </div>
                                <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F172A' }}>
                                  {b.customer_name}
                                </div>
                                <div style={{ fontSize: '11px', color: '#475569' }}>
                                  {b.services.join(', ')} · {(b.amount_minor / 100).toLocaleString('ru-RU')} ₸
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Appointment Detail & Status Change Modal */}
      {selectedBooking && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setSelectedBooking(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '480px',
              background: '#FFFFFF',
              borderRadius: '20px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800 }}>Карточка записи</h2>
                <span style={{ fontSize: '13px', color: '#64748B' }}>Код визита: #{selectedBooking.public_ref}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBooking(null)}
                style={{
                  background: 'none',
                  border: 0,
                  fontSize: '20px',
                  color: '#64748B',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                padding: '14px',
                borderRadius: '12px',
                background: '#F8FAFC',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                fontSize: '14px',
              }}
            >
              <div>
                <span style={{ color: '#64748B' }}>Клиент: </span>
                <strong style={{ color: '#0F172A' }}>{selectedBooking.customer_name}</strong>
              </div>
              <div>
                <span style={{ color: '#64748B' }}>Телефон: </span>
                <strong style={{ color: '#0F172A' }}>{selectedBooking.customer_phone}</strong>
              </div>
              <div>
                <span style={{ color: '#64748B' }}>Услуги: </span>
                <strong style={{ color: '#0F172A' }}>{selectedBooking.services.join(', ')}</strong>
              </div>
              <div>
                <span style={{ color: '#64748B' }}>Сумма к оплате: </span>
                <strong style={{ color: '#0F172A' }}>
                  {(selectedBooking.amount_minor / 100).toLocaleString('ru-RU')} ₸
                </strong>
              </div>
              <div>
                <span style={{ color: '#64748B' }}>Текущий статус: </span>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    ...getStatusColor(selectedBooking.status),
                  }}
                >
                  {getStatusColor(selectedBooking.status).label}
                </span>
              </div>
            </div>

            {/* Action Buttons to Update Status */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>
                Изменить статус визита:
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {selectedBooking.status !== 'arrived' && (
                  <button
                    type="button"
                    disabled={statusUpdating}
                    onClick={() => handleUpdateStatus('arrived')}
                    style={{
                      padding: '10px',
                      borderRadius: '10px',
                      border: '1px solid #FCD34D',
                      background: '#FEF3C7',
                      color: '#92400E',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    Клиент прибыл
                  </button>
                )}
                {selectedBooking.status !== 'in_progress' && (
                  <button
                    type="button"
                    disabled={statusUpdating}
                    onClick={() => handleUpdateStatus('in_progress')}
                    style={{
                      padding: '10px',
                      borderRadius: '10px',
                      border: '1px solid #93C5FD',
                      background: '#DBEAFE',
                      color: '#1E40AF',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    В работе
                  </button>
                )}
                {selectedBooking.status !== 'completed' && (
                  <button
                    type="button"
                    disabled={statusUpdating}
                    onClick={() => handleUpdateStatus('completed')}
                    style={{
                      padding: '10px',
                      borderRadius: '10px',
                      border: '1px solid #86EFAC',
                      background: '#DCFCE7',
                      color: '#166534',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    Завершить визит
                  </button>
                )}
                {selectedBooking.status !== 'cancelled' && (
                  <button
                    type="button"
                    disabled={statusUpdating}
                    onClick={() => handleUpdateStatus('cancelled')}
                    style={{
                      padding: '10px',
                      borderRadius: '10px',
                      border: '1px solid #FCA5A5',
                      background: '#FEE2E2',
                      color: '#991B1B',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    Отменить
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
