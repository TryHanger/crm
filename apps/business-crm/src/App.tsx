import React, { useState, useEffect } from 'react';
import { BusinessCrmApiClient } from '@crm/api-client';

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

  // Demo tenant credentials
  const demoAccounts = [
    {
      label: 'Barber House (Owner)',
      email: 'owner@barberhouse.kz',
      password: 'Password123!',
      brandName: 'BARBER HOUSE',
      slug: 'barberhouse',
    },
    {
      label: 'Modern Cut (Owner)',
      email: 'owner@moderncut.kz',
      password: 'Password123!',
      brandName: 'MODERN CUT',
      slug: 'moderncut',
    },
  ];

  const [selectedAccount, setSelectedAccount] = useState(demoAccounts[0]);
  const [token, setToken] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

  // Calendar state
  const [currentDate, setCurrentDate] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });
  const [staffList, setStaffList] = useState<CalendarStaff[]>([]);
  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<CalendarBooking | null>(null);

  // Login handler
  const login = async (account = selectedAccount) => {
    try {
      setIsLoading(true);
      const res = await api.login({
        email: account.email,
        password: account.password,
      });
      setToken(res.access_token);

      const me = await api.getMe(res.access_token);
      const activeTenantId = me.tenant_id;
      setTenantId(activeTenantId);

      // Fetch branches for this tenant
      const branchRes = await fetch('/api/v1/business/branches', {
        headers: {
          Authorization: `Bearer ${res.access_token}`,
          'X-Tenant-ID': activeTenantId,
        },
      });
      if (branchRes.ok) {
        const brs = await branchRes.json();
        setBranches(brs);
        if (brs.length > 0) {
          setSelectedBranchId(brs[0].id);
        }
      }
    } catch (err: any) {
      console.error('Login error', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    login(selectedAccount);
  }, [selectedAccount]);

  // Fetch calendar data
  const loadCalendar = async () => {
    if (!token || !tenantId || !selectedBranchId) return;

    try {
      setIsLoading(true);
      const calData = await api.getCalendar(
        { date: currentDate, branch_id: selectedBranchId },
        token,
        tenantId
      );
      setStaffList(calData.staff || []);
      setBookings(calData.bookings || []);
    } catch (err: any) {
      console.error('Failed to load calendar', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCalendar();
  }, [token, tenantId, selectedBranchId, currentDate]);

  const handleUpdateStatus = async (newStatus: string) => {
    if (!selectedBooking || !token || !tenantId) return;

    try {
      await api.updateBookingStatus(
        selectedBooking.id,
        { status: newStatus as any },
        token,
        tenantId
      );
      setSelectedBooking(null);
      await loadCalendar();
    } catch (err: any) {
      console.error('Failed to update status', err);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed':
        return { label: 'Подтверждена', bg: '#DBEAFE', color: '#1D4ED8' };
      case 'arrived':
        return { label: 'Клиент пришёл', bg: '#CCFBF1', color: '#0F766E' };
      case 'in_progress':
        return { label: 'В процессе', bg: '#FEF3C7', color: '#B45309' };
      case 'completed':
        return { label: 'Завершена', bg: '#DCFCE7', color: '#15803D' };
      case 'cancelled':
        return { label: 'Отменена', bg: '#FEE2E2', color: '#B91C1C' };
      default:
        return { label: status, bg: '#F1F5F9', color: '#475569' };
    }
  };

  // Time grid hours
  const hours = Array.from({ length: 12 }, (_, i) => i + 9); // 09:00 - 20:00

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#F8FAFC' }}>
      {/* Top Navbar */}
      <header
        style={{
          height: '60px',
          background: '#FFFFFF',
          borderBottom: '1px solid #E2E8F0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: '#0F172A',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '14px',
            }}
          >
            {selectedAccount.brandName.slice(0, 2)}
          </div>
          <span style={{ fontWeight: 700, fontSize: '16px', letterSpacing: '0.04em' }}>
            {selectedAccount.brandName} CRM
          </span>

          {/* Tenant Switcher (Barber House vs Modern Cut) */}
          <select
            value={selectedAccount.slug}
            onChange={e => {
              const acc = demoAccounts.find(a => a.slug === e.target.value);
              if (acc) setSelectedAccount(acc);
            }}
            style={{
              height: '36px',
              padding: '0 10px',
              borderRadius: '8px',
              border: '1px solid #CBD5E1',
              background: '#F8FAFC',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            {demoAccounts.map(a => (
              <option key={a.slug} value={a.slug}>
                {a.label}
              </option>
            ))}
          </select>

          {/* Branch Switcher */}
          {branches.length > 0 && (
            <select
              value={selectedBranchId || ''}
              onChange={e => setSelectedBranchId(e.target.value)}
              style={{
                height: '36px',
                padding: '0 10px',
                borderRadius: '8px',
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              {branches.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Date Selector & Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="date"
            value={currentDate}
            onChange={e => setCurrentDate(e.target.value)}
            style={{
              height: '36px',
              padding: '0 10px',
              borderRadius: '8px',
              border: '1px solid #CBD5E1',
              fontSize: '13px',
            }}
          />
          <button
            type="button"
            onClick={loadCalendar}
            style={{
              height: '36px',
              padding: '0 14px',
              borderRadius: '8px',
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              color: '#0F172A',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Обновить
          </button>
        </div>
      </header>

      {/* Main Calendar Area */}
      <main style={{ flex: 1, padding: '24px', overflowX: 'auto' }}>
        <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>
            Календарь записей на {currentDate}
          </h1>
          <span style={{ color: '#64748B', fontSize: '14px' }}>
            Всего записей: {bookings.length}
          </span>
        </div>

        {/* Staff Columns Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `80px repeat(${Math.max(1, staffList.length)}, minmax(220px, 1fr))`,
            background: '#FFFFFF',
            borderRadius: '16px',
            border: '1px solid #E2E8F0',
            overflow: 'hidden',
          }}
        >
          {/* Header row */}
          <div
            style={{
              padding: '14px',
              background: '#F8FAFC',
              borderBottom: '1px solid #E2E8F0',
              borderRight: '1px solid #E2E8F0',
              fontWeight: 600,
              fontSize: '13px',
              color: '#64748B',
            }}
          >
            Время
          </div>
          {staffList.map(st => (
            <div
              key={st.id}
              style={{
                padding: '14px',
                background: '#F8FAFC',
                borderBottom: '1px solid #E2E8F0',
                borderRight: '1px solid #E2E8F0',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: '#E2E8F0',
                  color: '#334155',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: '12px',
                }}
              >
                {st.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{st.name}</div>
                <div style={{ fontSize: '12px', color: '#64748B' }}>{st.role_title || 'Барбер'}</div>
              </div>
            </div>
          ))}

          {/* Time Rows */}
          {hours.map(hour => {
            const timeStr = `${hour.toString().padStart(2, '0')}:00`;
            return (
              <React.Fragment key={hour}>
                {/* Time Label */}
                <div
                  style={{
                    height: '90px',
                    padding: '8px',
                    borderBottom: '1px solid #F1F5F9',
                    borderRight: '1px solid #E2E8F0',
                    color: '#64748B',
                    fontSize: '12px',
                    fontWeight: 500,
                    textAlign: 'center',
                  }}
                >
                  {timeStr}
                </div>

                {/* Staff Cells */}
                {staffList.map(st => {
                  // Find bookings starting in this hour for this staff
                  const cellBookings = bookings.filter(b => {
                    if (b.staff_id !== st.id) return false;
                    const bDate = new Date(b.starts_at_utc);
                    const bHour = (bDate.getUTCHours() + 5) % 24;
                    return bHour === hour;
                  });

                  return (
                    <div
                      key={st.id}
                      style={{
                        height: '90px',
                        padding: '6px',
                        borderBottom: '1px solid #F1F5F9',
                        borderRight: '1px solid #E2E8F0',
                        position: 'relative',
                        background: '#FFFFFF',
                      }}
                    >
                      {cellBookings.map(b => {
                        const badge = getStatusBadge(b.status);
                        const bDate = new Date(b.starts_at_utc);
                        const tStr = bDate.toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Asia/Almaty',
                        });

                        return (
                          <div
                            key={b.id}
                            onClick={() => setSelectedBooking(b)}
                            style={{
                              padding: '6px 10px',
                              borderRadius: '8px',
                              background: badge.bg,
                              border: `1px solid ${badge.color}33`,
                              color: '#0F172A',
                              fontSize: '12px',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, color: badge.color }}>{tStr}</span>
                              <span style={{ fontSize: '10px', fontWeight: 600, color: badge.color }}>
                                #{b.public_ref}
                              </span>
                            </div>
                            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {b.customer_name}
                            </div>
                            <div style={{ color: '#475569', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {b.services.join(', ')}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </main>

      {/* Booking Details & Status Modal */}
      {selectedBooking && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: '420px',
              background: '#FFFFFF',
              borderRadius: '16px',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                Запись #{selectedBooking.public_ref}
              </h2>
              <button
                type="button"
                onClick={() => setSelectedBooking(null)}
                style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: '18px' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '14px' }}>
              <div>
                <span style={{ color: '#64748B' }}>Клиент: </span>
                <b>{selectedBooking.customer_name}</b> ({selectedBooking.customer_phone})
              </div>
              <div>
                <span style={{ color: '#64748B' }}>Услуги: </span>
                <span>{selectedBooking.services.join(', ')}</span>
              </div>
              <div>
                <span style={{ color: '#64748B' }}>Стоимость: </span>
                <b>{(selectedBooking.amount_minor / 100).toLocaleString('ru-RU')} ₸</b>
              </div>
              <div>
                <span style={{ color: '#64748B' }}>Текущий статус: </span>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: '6px',
                    fontWeight: 600,
                    background: getStatusBadge(selectedBooking.status).bg,
                    color: getStatusBadge(selectedBooking.status).color,
                  }}
                >
                  {getStatusBadge(selectedBooking.status).label}
                </span>
              </div>
            </div>

            <div style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginTop: '6px' }}>
              Изменить статус записи:
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                type="button"
                onClick={() => handleUpdateStatus('arrived')}
                style={{
                  height: '38px',
                  borderRadius: '8px',
                  border: '1px solid #0F766E',
                  background: '#CCFBF1',
                  color: '#0F766E',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Клиент пришёл
              </button>
              <button
                type="button"
                onClick={() => handleUpdateStatus('in_progress')}
                style={{
                  height: '38px',
                  borderRadius: '8px',
                  border: '1px solid #B45309',
                  background: '#FEF3C7',
                  color: '#B45309',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                В процессе
              </button>
              <button
                type="button"
                onClick={() => handleUpdateStatus('completed')}
                style={{
                  height: '38px',
                  borderRadius: '8px',
                  border: '1px solid #15803D',
                  background: '#DCFCE7',
                  color: '#15803D',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Завершена
              </button>
              <button
                type="button"
                onClick={() => handleUpdateStatus('cancelled')}
                style={{
                  height: '38px',
                  borderRadius: '8px',
                  border: '1px solid #B91C1C',
                  background: '#FEE2E2',
                  color: '#B91C1C',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Отменить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
