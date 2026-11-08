import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  Users,
  CalendarCheck,
  CreditCard,
  RefreshCw,
  AlertCircle
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
      <div className="p-8 max-w-4xl mx-auto">
        <div className="p-6 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-start gap-4">
          <AlertCircle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-lg font-medium text-white">Доступ ограничен</h3>
            <p className="text-sm text-neutral-400 mt-1">
              Просмотр общей финансовой аналитики и сводных отчетов филиала доступен только управляющим (admin) и владельцам бизнеса (owner).
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
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header & Range Selectors */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Отчёты и аналитика</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Сводные операционные показатели и разграничение плановой стоимости и факт-оплат
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-xl p-1">
            <button
              onClick={() => setPresetRange('today')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                dateRangeType === 'today'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Сегодня
            </button>
            <button
              onClick={() => setPresetRange('week')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                dateRangeType === 'week'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              7 дней
            </button>
            <button
              onClick={() => setPresetRange('month')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                dateRangeType === 'month'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Этот месяц
            </button>
          </div>

          <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-1.5">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setDateRangeType('custom');
                setFromDate(e.target.value);
              }}
              className="bg-transparent text-xs text-white outline-none cursor-pointer"
            />
            <span className="text-neutral-500 text-xs">—</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setDateRangeType('custom');
                setToDate(e.target.value);
              }}
              className="bg-transparent text-xs text-white outline-none cursor-pointer"
            />
          </div>

          <button
            onClick={fetchReports}
            className="p-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 rounded-xl transition-colors"
            title="Обновить отчет"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !report ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-neutral-900/60 rounded-2xl border border-neutral-800" />
          ))}
        </div>
      ) : report ? (
        <>
          {/* Key KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Total Bookings */}
            <div className="bg-neutral-900/80 border border-neutral-800/80 rounded-2xl p-5 hover:border-neutral-700/80 transition-colors">
              <div className="flex items-center justify-between text-neutral-400 mb-3">
                <span className="text-xs font-medium uppercase tracking-wider">Всего записей</span>
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400">
                  <CalendarCheck className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-bold text-white">{report.total_bookings}</div>
              <div className="flex items-center gap-3 text-xs text-neutral-400 mt-3 pt-3 border-t border-neutral-800/60">
                <span className="text-emerald-400 font-medium">✓ {report.completed_bookings} завершено</span>
                <span className="text-red-400 font-medium">✕ {report.cancelled_bookings} отменено</span>
              </div>
            </div>

            {/* 2. Actual Revenue */}
            <div className="bg-neutral-900/80 border border-neutral-800/80 rounded-2xl p-5 hover:border-neutral-700/80 transition-colors">
              <div className="flex items-center justify-between text-neutral-400 mb-3">
                <span className="text-xs font-medium uppercase tracking-wider">Факт-выручка</span>
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
                  <CreditCard className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-bold text-emerald-400">
                {formatCurrency(report.actual_revenue_minor || 0)}
              </div>
              <div className="text-xs text-neutral-400 mt-3 pt-3 border-t border-neutral-800/60">
                Оплачено по завершенным визитам
              </div>
            </div>

            {/* 3. Planned Revenue */}
            <div className="bg-neutral-900/80 border border-neutral-800/80 rounded-2xl p-5 hover:border-neutral-700/80 transition-colors">
              <div className="flex items-center justify-between text-neutral-400 mb-3">
                <span className="text-xs font-medium uppercase tracking-wider">Плановая стоимость</span>
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-bold text-amber-300">
                {formatCurrency(report.planned_revenue_minor || 0)}
              </div>
              <div className="text-xs text-neutral-400 mt-3 pt-3 border-t border-neutral-800/60">
                Сумма всех активных записей
              </div>
            </div>

            {/* 4. New Customers & Workload */}
            <div className="bg-neutral-900/80 border border-neutral-800/80 rounded-2xl p-5 hover:border-neutral-700/80 transition-colors">
              <div className="flex items-center justify-between text-neutral-400 mb-3">
                <span className="text-xs font-medium uppercase tracking-wider">Новые клиенты</span>
                <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
                  <Users className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-bold text-purple-300">
                +{report.new_customers_count || 0}
              </div>
              <div className="text-xs text-neutral-400 mt-3 pt-3 border-t border-neutral-800/60">
                Занятость: {Math.round((report.occupied_minutes || 0) / 60)} ч. услуг
              </div>
            </div>
          </div>

          {/* Revenue Clarity Notice */}
          <div className="p-4 bg-neutral-900/40 border border-neutral-800 rounded-xl flex items-center justify-between text-xs text-neutral-400">
            <span className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Разграничение метрик:</strong> Плановая стоимость отражает ожидаемую сумму броней в графике. Факт-выручка формируется исключительно после завершения визитов.
              </span>
            </span>
            <span className="text-neutral-500 hidden sm:inline">
              Часовой пояс: филиал (Asia/Almaty)
            </span>
          </div>

          {/* Staff Performance Table */}
          <div className="bg-neutral-900/80 border border-neutral-800/80 rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-neutral-800">
              <h2 className="text-base font-semibold text-white">Выработка мастеров</h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                Количество визитов и фактический доход по каждому специалисту
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-neutral-950/50 text-neutral-400 text-xs uppercase tracking-wider border-b border-neutral-800">
                    <th className="py-3 px-5">Мастер</th>
                    <th className="py-3 px-5">Записей</th>
                    <th className="py-3 px-5">Факт-выручка</th>
                    <th className="py-3 px-5">Загрузка</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/50">
                  {report.staff_stats && report.staff_stats.length > 0 ? (
                    report.staff_stats.map((st) => (
                      <tr key={st.staff_id} className="hover:bg-neutral-800/30 transition-colors">
                        <td className="py-3.5 px-5 font-medium text-white">
                          {st.staff_name}
                        </td>
                        <td className="py-3.5 px-5 text-neutral-300">
                          {st.bookings_count} визитов
                        </td>
                        <td className="py-3.5 px-5 font-semibold text-emerald-400">
                          {formatCurrency(st.revenue_minor)}
                        </td>
                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-3">
                            <div className="w-24 bg-neutral-800 rounded-full h-2 overflow-hidden">
                              <div
                                className="bg-amber-500 h-2 rounded-full"
                                style={{ width: `${Math.min(100, st.workload_pct || 0)}%` }}
                              />
                            </div>
                            <span className="text-xs text-neutral-400 w-8">
                              {st.workload_pct || 0}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-neutral-500 text-xs">
                        Нет данных о работе мастеров за выбранный период
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
