import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  Users,
  CalendarCheck,
  CreditCard,
  RefreshCw,
  AlertCircle,
  Clock,
  Info
} from 'lucide-react';
import { BusinessCrmApiClient, ReportsOverviewResponse } from '@crm/api-client';

interface ReportsModuleProps {
  api: BusinessCrmApiClient;
  token: string;
  tenantId: string;
  currentBranchId?: string;
  userRole: string;
  onShowToast?: (msg: string) => void;
}

export const ReportsModule: React.FC<ReportsModuleProps> = ({
  api,
  token,
  tenantId,
  currentBranchId,
  userRole,
  onShowToast,
}) => {
  const [report, setReport] = useState<ReportsOverviewResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Date filters
  const todayStr = new Date().toISOString().split('T')[0];
  const [dateRangeType, setDateRangeType] = useState<'today' | 'week' | 'month' | 'custom'>('month');

  const getInitialDates = () => {
    const d = new Date();
    const firstDay = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
    return { from: firstDay, to: todayStr };
  };

  const [fromDate, setFromDate] = useState<string>(getInitialDates().from);
  const [toDate, setToDate] = useState<string>(getInitialDates().to);

  const setPresetRange = (type: 'today' | 'week' | 'month') => {
    setDateRangeType(type);
    const now = new Date();
    if (type === 'today') {
      setFromDate(todayStr);
      setToDate(todayStr);
    } else if (type === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(now.getDate() - 7);
      setFromDate(weekAgo.toISOString().split('T')[0]);
      setToDate(todayStr);
    } else if (type === 'month') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      setFromDate(monthStart.toISOString().split('T')[0]);
      setToDate(todayStr);
    }
  };

  const fetchReports = async () => {
    if (userRole === 'master') {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.getReportsOverview(
        {
          from_date: fromDate,
          to_date: toDate,
          branch_id: currentBranchId,
        },
        token,
        tenantId
      );
      setReport(data);
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить отчеты');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [fromDate, toDate, currentBranchId, userRole, token, tenantId]);

  if (userRole === 'master') {
    return (
      <div style={{ padding: '32px', maxWidth: '800px', margin: '0 auto' }}>
        <div style={{ padding: '24px', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '16px', display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
          <AlertCircle style={{ width: '24px', height: '24px', color: '#D97706', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#92400E' }}>Доступ ограничен</h3>
            <p style={{ margin: '6px 0 0', fontSize: '14px', color: '#B45309' }}>
              Просмотр общей финансовой аналитики и сводных отчетов доступен только управляющим (admin) и владельцам бизнеса (owner).
            </p>
          </div>
        </div>
      </div>
    );
  }

  const formatCurrency = (minor: number) => {
    return `${(minor / 100).toLocaleString('ru-RU')} ₸`;
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1440px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px', boxSizing: 'border-box' }}>
      {/* Top Header & Range Selectors */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>
            Отчёты и аналитика
          </h2>
          <p style={{ fontSize: '13px', color: '#64748B', margin: '4px 0 0' }}>
            Сводные операционные показатели и разграничение плановой стоимости и факт-оплат
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Preset Buttons */}
          <div style={{ display: 'flex', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '3px', gap: '2px' }}>
            <button
              type="button"
              onClick={() => setPresetRange('today')}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: dateRangeType === 'today' ? 600 : 500,
                borderRadius: '8px',
                border: 'none',
                background: dateRangeType === 'today' ? '#FFFFFF' : 'transparent',
                color: dateRangeType === 'today' ? '#1D4ED8' : '#64748B',
                boxShadow: dateRangeType === 'today' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                cursor: 'pointer',
              }}
            >
              Сегодня
            </button>
            <button
              type="button"
              onClick={() => setPresetRange('week')}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: dateRangeType === 'week' ? 600 : 500,
                borderRadius: '8px',
                border: 'none',
                background: dateRangeType === 'week' ? '#FFFFFF' : 'transparent',
                color: dateRangeType === 'week' ? '#1D4ED8' : '#64748B',
                boxShadow: dateRangeType === 'week' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                cursor: 'pointer',
              }}
            >
              7 дней
            </button>
            <button
              type="button"
              onClick={() => setPresetRange('month')}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: dateRangeType === 'month' ? 600 : 500,
                borderRadius: '8px',
                border: 'none',
                background: dateRangeType === 'month' ? '#FFFFFF' : 'transparent',
                color: dateRangeType === 'month' ? '#1D4ED8' : '#64748B',
                boxShadow: dateRangeType === 'month' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                cursor: 'pointer',
              }}
            >
              Этот месяц
            </button>
          </div>

          {/* Date Picker Inputs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '10px', padding: '4px 10px' }}>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setDateRangeType('custom');
                setFromDate(e.target.value);
              }}
              style={{ border: 'none', outline: 'none', fontSize: '13px', color: '#0F172A', background: 'transparent', cursor: 'pointer' }}
            />
            <span style={{ color: '#94A3B8', fontSize: '13px' }}>—</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setDateRangeType('custom');
                setToDate(e.target.value);
              }}
              style={{ border: 'none', outline: 'none', fontSize: '13px', color: '#0F172A', background: 'transparent', cursor: 'pointer' }}
            />
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={fetchReports}
            title="Обновить отчет"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              color: '#475569',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <RefreshCw style={{ width: '16px', height: '16px' }} />
          </button>
        </div>
      </div>

      {/* Semantic Notification Banner */}
      <div style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <Info style={{ width: '18px', height: '18px', color: '#2563EB', flexShrink: 0, marginTop: '2px' }} />
        <div style={{ fontSize: '13px', color: '#1E40AF', lineHeight: '1.5' }}>
          <b>Разграничение метрик:</b> Плановая стоимость отражает ожидаемую сумму всех активных броней в графике.
          Стоимость завершённых визитов (Факт оказания) фиксирует факт предоставления услуг по закрытым записям.
          Денежный эквайринг и кассовый учёт фактических оплат находятся на этапе подключения.
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', color: '#DC2626', fontSize: '14px' }}>
          <AlertCircle style={{ width: '18px', height: '18px', flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {loading && !report ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ height: '140px', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '16px', opacity: 0.6 }} />
          ))}
        </div>
      ) : report ? (
        <>
          {/* Key KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
            {/* 1. Total Bookings */}
            <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Всего записей
                </span>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CalendarCheck style={{ width: '18px', height: '18px' }} />
                </div>
              </div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: '#0F172A', lineHeight: '1' }}>
                {report.total_bookings}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #F1F5F9' }}>
                <span style={{ color: '#059669', fontWeight: 600 }}>✓ {report.completed_bookings} завершено</span>
                <span style={{ color: '#DC2626', fontWeight: 600 }}>✕ {report.cancelled_bookings} отменено</span>
              </div>
            </div>

            {/* 2. Actual Revenue / Completed Visits Value */}
            <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Факт-выручка
                  </span>
                  <div style={{ fontSize: '11px', color: '#64748B' }}>Стоимость завершённых визитов</div>
                </div>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#ECFDF5', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CreditCard style={{ width: '18px', height: '18px' }} />
                </div>
              </div>
              <div style={{ fontSize: '30px', fontWeight: 800, color: '#059669', lineHeight: '1' }}>
                {formatCurrency(report.completed_revenue_minor ?? report.actual_revenue_minor ?? 0)}
              </div>
              <div style={{ fontSize: '11px', color: '#64748B', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #F1F5F9' }}>
                Оказанные услуги (кассовый приём оплат отключён)
              </div>
            </div>

            {/* 3. Planned Revenue */}
            <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#D97706', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Плановая стоимость
                </span>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#FFFBEB', color: '#D97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <TrendingUp style={{ width: '18px', height: '18px' }} />
                </div>
              </div>
              <div style={{ fontSize: '30px', fontWeight: 800, color: '#D97706', lineHeight: '1' }}>
                {formatCurrency(report.planned_revenue_minor || 0)}
              </div>
              <div style={{ fontSize: '11px', color: '#64748B', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #F1F5F9' }}>
                Сумма всех активных записей в графике
              </div>
            </div>

            {/* 4. Staff Utilization & Clients */}
            <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Выработка мастеров
                </span>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#F5F3FF', color: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Users style={{ width: '18px', height: '18px' }} />
                </div>
              </div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: '#0F172A', lineHeight: '1' }}>
                {report.new_customers_count}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#64748B', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #F1F5F9' }}>
                <Clock style={{ width: '14px', height: '14px' }} />
                <span>{report.occupied_minutes || 0} мин занятого времени</span>
              </div>
            </div>
          </div>

          {/* Master Utilization & Performance Table */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0F172A' }}>
                  Выработка специалистов и занятость
                </h3>
                <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>
                  Соотношение времени обслуживания к продолжительности рабочих смен филиала
                </div>
              </div>
            </div>

            <div style={{ overflowX: 'auto', width: '100%' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', color: '#64748B', fontWeight: 600 }}>
                    <th style={{ padding: '12px 20px' }}>Специалист</th>
                    <th style={{ padding: '12px 16px' }}>Записей</th>
                    <th style={{ padding: '12px 16px' }}>Отработано (мин)</th>
                    <th style={{ padding: '12px 16px' }}>Загрузка смены</th>
                    <th style={{ padding: '12px 20px', textAlign: 'right' }}>Факт-выручка</th>
                  </tr>
                </thead>
                <tbody>
                  {report.staff_stats && report.staff_stats.length > 0 ? (
                    report.staff_stats.map((s, idx) => (
                      <tr key={s.staff_id || idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '12px 20px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#2563EB', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '12px' }}>
                              {(s.staff_name || 'СП').slice(0, 2).toUpperCase()}
                            </div>
                            <span style={{ fontWeight: 600, color: '#0F172A' }}>{s.staff_name}</span>
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px', color: '#334155' }}>
                          {s.bookings_count} шт.
                        </td>
                        <td style={{ padding: '12px 16px', color: '#334155' }}>
                          {s.booked_minutes} мин
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '100px', height: '6px', background: '#E2E8F0', borderRadius: '3px', overflow: 'hidden' }}>
                              <div
                                style={{
                                  width: `${Math.min(100, Math.max(0, s.workload_pct || 0))}%`,
                                  height: '100%',
                                  background: (s.workload_pct || 0) > 80 ? '#D97706' : '#2563EB',
                                  borderRadius: '3px',
                                }}
                              />
                            </div>
                            <span style={{ fontWeight: 600, fontSize: '12px', color: '#0F172A' }}>
                              {s.workload_pct || 0}%
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700, color: '#059669' }}>
                          {formatCurrency(s.revenue_minor || 0)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#94A3B8' }}>
                        Нет данных о выработке специалистов за выбранный период
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};
