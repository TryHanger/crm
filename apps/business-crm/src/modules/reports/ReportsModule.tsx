import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  Users,
  CalendarCheck,
  CreditCard,
  RefreshCw,
  AlertCircle,
  Clock,
  Info,
  Download,
  Plus,
  Trash2,
  DollarSign,
  ArrowDownRight,
  ArrowUpRight,
  FileText
} from 'lucide-react';
import {
  BusinessCrmApiClient,
  VisitsReportData,
  ServicesReportData,
  FinanceReportData,
  DebtsReportData,
  ExpenseRecord,
  DebtItem,
} from '@crm/api-client';

interface ReportsModuleProps {
  api: BusinessCrmApiClient;
  token: string;
  tenantId: string;
  currentBranchId?: string;
  userRole: string;
  onShowToast?: (msg: string) => void;
}

export type ReportTab = 'finance' | 'visits' | 'services' | 'debts';

export const ReportsModule: React.FC<ReportsModuleProps> = ({
  api,
  token,
  tenantId,
  currentBranchId,
  userRole,
  onShowToast,
}) => {
  const [activeTab, setActiveTab] = useState<ReportTab>('finance');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Data states for 4 reports
  const [financeReport, setFinanceReport] = useState<FinanceReportData | null>(null);
  const [visitsReport, setVisitsReport] = useState<VisitsReportData | null>(null);
  const [servicesReport, setServicesReport] = useState<ServicesReportData | null>(null);
  const [debtsReport, setDebtsReport] = useState<DebtsReportData | null>(null);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);

  // Expense modal state
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseCategory, setExpenseCategory] = useState('Материалы и косметика');
  const [expenseAmountStr, setExpenseAmountStr] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [expenseMethod, setExpenseMethod] = useState<'cash' | 'account'>('account');
  const [expenseComment, setExpenseComment] = useState('');
  const [isSubmittingExpense, setIsSubmittingExpense] = useState(false);

  // Date filters
  const todayStr = new Date().toISOString().split('T')[0];
  const [dateRangeType, setDateRangeType] = useState<'today' | 'yesterday' | 'week' | 'month' | 'prev_month' | 'custom'>('month');

  const getInitialDates = () => {
    const d = new Date();
    const firstDay = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
    return { from: firstDay, to: todayStr };
  };

  const [fromDate, setFromDate] = useState<string>(getInitialDates().from);
  const [toDate, setToDate] = useState<string>(getInitialDates().to);

  const setPresetRange = (type: 'today' | 'yesterday' | 'week' | 'month' | 'prev_month') => {
    setDateRangeType(type);
    const now = new Date();
    if (type === 'today') {
      setFromDate(todayStr);
      setToDate(todayStr);
    } else if (type === 'yesterday') {
      const y = new Date();
      y.setDate(now.getDate() - 1);
      const yStr = y.toISOString().split('T')[0];
      setFromDate(yStr);
      setToDate(yStr);
    } else if (type === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(now.getDate() - 7);
      setFromDate(weekAgo.toISOString().split('T')[0]);
      setToDate(todayStr);
    } else if (type === 'month') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      setFromDate(monthStart.toISOString().split('T')[0]);
      setToDate(todayStr);
    } else if (type === 'prev_month') {
      const prevMonthFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonthLast = new Date(now.getFullYear(), now.getMonth(), 0);
      setFromDate(prevMonthFirst.toISOString().split('T')[0]);
      setToDate(prevMonthLast.toISOString().split('T')[0]);
    }
  };

  const fetchReports = useCallback(async () => {
    if (!token || !tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const [fin, vis, srv, deb, expList] = await Promise.all([
        api.getFinanceReport({ branchId: currentBranchId, fromDate, toDate }, token, tenantId),
        api.getVisitsReport({ branchId: currentBranchId, fromDate, toDate }, token, tenantId),
        api.getServicesReport({ branchId: currentBranchId, fromDate, toDate }, token, tenantId),
        api.getDebtsReport({ branchId: currentBranchId }, token, tenantId),
        api.getExpenses(currentBranchId, token, tenantId, fromDate, toDate),
      ]);

      setFinanceReport(fin);
      setVisitsReport(vis);
      setServicesReport(srv);
      setDebtsReport(deb);
      setExpenses(expList || []);
    } catch (err: any) {
      console.error('Failed to load reports:', err);
      setError(err?.message || 'Не удалось загрузить отчёты');
    } finally {
      setLoading(false);
    }
  }, [api, token, tenantId, currentBranchId, fromDate, toDate]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Handle Add Expense
  const handleAddExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountVal = parseFloat(expenseAmountStr);
    if (isNaN(amountVal) || amountVal <= 0) {
      onShowToast?.('Введите корректную сумму расхода');
      return;
    }
    try {
      setIsSubmittingExpense(true);
      const newExp = await api.createExpense(
        {
          branch_id: currentBranchId,
          category: expenseCategory === 'supplies' ? 'Материалы и косметика' : expenseCategory,
          amount_minor: Math.round(amountVal * 100),
          expense_date: expenseDate,
          created_by: userRole === 'owner' ? 'Владелец' : 'Администратор',
          payment_method: expenseMethod,
          comment: expenseComment.trim() || undefined,
        },
        token,
        tenantId
      );
      if (newExp) {
        setExpenses(prev => [newExp, ...prev.filter(e => e.id !== newExp.id)]);
      }
      onShowToast?.('Расход успешно добавлен');
      setShowExpenseModal(false);
      setExpenseAmountStr('');
      setExpenseComment('');
      fetchReports();
    } catch (err: any) {
      onShowToast?.(`Ошибка добавления расхода: ${err.message || err}`);
    } finally {
      setIsSubmittingExpense(false);
    }
  };

  // Handle Delete Expense
  const handleDeleteExpense = async (id: string) => {
    if (!window.confirm('Удалить эту запись расхода?')) return;
    try {
      await api.deleteExpense(id, token, tenantId);
      onShowToast?.('Расход удален');
      fetchReports();
    } catch (err: any) {
      onShowToast?.(`Ошибка удаления: ${err.message || err}`);
    }
  };

  // Export Table to CSV
  const handleExportCsv = () => {
    let csvContent = '\uFEFF'; // UTF-8 BOM for Excel
    let filename = `report_${activeTab}_${fromDate}_${toDate}.csv`;

    if (activeTab === 'finance') {
      filename = `finance_cash_flow_${fromDate}_${toDate}.csv`;
      csvContent += 'Показатель,Сумма (KZT),Примечание\n';
      if (financeReport) {
        csvContent += `Оказано услуг (факт завершения),${(financeReport.rendered_minor / 100).toFixed(2)},Стоимость завершенных визитов\n`;
        csvContent += `Поступления (касса + безнал),${(financeReport.paid_minor / 100).toFixed(2)},Фактические оплаты клиентов\n`;
        csvContent += `Дебиторская задолженность (долг),${(financeReport.debt_minor / 100).toFixed(2)},Оказано услуг минус получено оплат\n`;
        csvContent += `Расходы салона,${(financeReport.expenses_minor / 100).toFixed(2)},Операционные затраты\n`;
        csvContent += `Возвраты клиентам,${(financeReport.refunds_minor / 100).toFixed(2)},Сторно и возвраты денег\n`;
        csvContent += `Авансы клиентов,${(financeReport.advances_minor / 100).toFixed(2)},Предоплаты (отдельно от выручки)\n`;
        csvContent += `Чистый денежный поток,${(financeReport.net_cash_flow_minor / 100).toFixed(2)},Поступления + Авансы - Расходы\n\n`;
      }
      csvContent += 'Журнал расходов:\nДата,Категория,Сумма (KZT),Способ,Автор,Комментарий\n';
      for (const e of expenses) {
        csvContent += `"${e.expense_date}","${e.category}",${(e.amount_minor / 100).toFixed(2)},"${e.payment_method === 'cash' ? 'Касса' : 'Счет'}","${e.created_by}","${e.comment || ''}"\n`;
      }
    } else if (activeTab === 'visits') {
      filename = `visits_report_${fromDate}_${toDate}.csv`;
      csvContent += 'ID / Ref,Клиент,Мастер,Услуги,Дата,Время,Статус,Сумма (KZT)\n';
      if (visitsReport) {
        for (const item of visitsReport.items) {
          csvContent += `"${item.public_ref}","${item.customer_name}","${item.staff_name}","${item.services.join('; ')}","${item.date_display}","${item.time_display}","${item.status}",${(item.amount_minor / 100).toFixed(2)}\n`;
        }
      }
    } else if (activeTab === 'services') {
      filename = `services_report_${fromDate}_${toDate}.csv`;
      csvContent += 'Услуга,Количество оказаний,Выручка (KZT),Доля в обороте (%)\n';
      if (servicesReport) {
        for (const s of servicesReport.top_services) {
          csvContent += `"${s.service_name}",${s.count},${(s.total_minor / 100).toFixed(2)},${s.percentage}%\n`;
        }
      }
    } else if (activeTab === 'debts') {
      filename = `debts_report_${todayStr}.csv`;
      csvContent += 'Визит Ref,Клиент,Телефон,Дата визита,Стоимость (KZT),Оказано (KZT),Оплачено (KZT),Остаток долга (KZT),Статус\n';
      if (debtsReport) {
        for (const d of debtsReport.items) {
          csvContent += `"${d.public_ref}","${d.customer_name}","${d.customer_phone}","${d.visit_date}",${(d.cost_minor / 100).toFixed(2)},${(d.rendered_minor / 100).toFixed(2)},${(d.paid_minor / 100).toFixed(2)},${(d.debt_minor / 100).toFixed(2)},"${d.payment_status === 'partially_paid' ? 'Частичная оплата' : 'Не оплачено'}"\n`;
        }
      }
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onShowToast?.('Файл отчёта экспортирован в CSV');
  };

  const formatCurrency = (minor?: number) => {
    const val = typeof minor === 'number' && !isNaN(minor) ? minor : 0;
    return `${(val / 100).toLocaleString('ru-RU')} ₸`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header & Filters Bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 800, color: '#0F172A' }}>Отчёты и аналитика</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '13.5px', color: '#64748B' }}>
              Базовые управленческие отчёты: визиты, услуги, касса/расходы и дебиторка
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              data-testid="export-csv-btn"
              onClick={handleExportCsv}
              style={{
                height: '38px',
                padding: '0 16px',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#334155',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Download style={{ width: '15px', height: '15px' }} />
              Экспорт таблицы в CSV
            </button>

            <button
              type="button"
              onClick={fetchReports}
              title="Обновить отчеты"
              style={{
                width: '38px',
                height: '38px',
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

        {/* Date Filter Bar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', background: '#FFFFFF', padding: '12px 16px', borderRadius: '14px', border: '1px solid #E2E8F0' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Период:</span>
          
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[
              { id: 'today', label: 'Сегодня' },
              { id: 'yesterday', label: 'Вчера' },
              { id: 'week', label: '7 дней' },
              { id: 'month', label: 'Этот месяц' },
              { id: 'prev_month', label: 'Прошлый месяц' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPresetRange(p.id as any)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: dateRangeType === p.id ? '1px solid #2563EB' : '1px solid #E2E8F0',
                  background: dateRangeType === p.id ? '#EFF6FF' : '#FFFFFF',
                  color: dateRangeType === p.id ? '#1D4ED8' : '#475569',
                  fontSize: '12.5px',
                  fontWeight: dateRangeType === p.id ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
            <span style={{ fontSize: '12px', color: '#64748B' }}>С:</span>
            <input
              type="date"
              data-testid="from-date-input"
              value={fromDate}
              onChange={(e) => {
                setDateRangeType('custom');
                setFromDate(e.target.value);
              }}
              style={{ height: '32px', padding: '0 8px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px' }}
            />
            <span style={{ fontSize: '12px', color: '#64748B' }}>По:</span>
            <input
              type="date"
              data-testid="to-date-input"
              value={toDate}
              onChange={(e) => {
                setDateRangeType('custom');
                setToDate(e.target.value);
              }}
              style={{ height: '32px', padding: '0 8px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px' }}
            />
          </div>
        </div>
      </div>

      {/* 4 Report Tabs Header */}
      <div
        data-testid="report-tabs"
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '2px solid #E2E8F0',
          paddingBottom: '2px',
        }}
      >
        {[
          { id: 'finance' as ReportTab, label: 'Поступления и расходы (Cash Flow)', icon: '💵' },
          { id: 'visits' as ReportTab, label: 'Визиты', icon: '📅' },
          { id: 'services' as ReportTab, label: 'Услуги', icon: '🏷️' },
          { id: 'debts' as ReportTab, label: 'Дебиторка (Долги клиентов)', icon: '⚠️' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`report-tab-${t.id}`}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'none',
              borderBottom: activeTab === t.id ? '3px solid #2563EB' : '3px solid transparent',
              color: activeTab === t.id ? '#2563EB' : '#64748B',
              fontSize: '14px',
              fontWeight: activeTab === t.id ? 700 : 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '-2px',
            }}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Semantic Notice Banner for M14 Rules */}
      <div
        style={{
          background: '#EFF6FF',
          border: '1px solid #DBEAFE',
          borderRadius: '12px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
        }}
      >
        <Info style={{ width: '18px', height: '18px', color: '#2563EB', flexShrink: 0, marginTop: '2px' }} />
        <div style={{ fontSize: '13px', color: '#1E40AF', lineHeight: '1.45' }}>
          <b>Строгое разграничение начислений и денег (M14):</b> В отчёте <b>Оказано</b> строго отражает стоимость завершённых визитов,
          <b>Поступления</b> — фактически внесённые деньги в кассу или через Kaspi, а <b>Долг</b> — неоплаченный остаток без смешивания статусов.
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', color: '#DC2626', fontSize: '14px' }}>
          <AlertCircle style={{ width: '18px', height: '18px', flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {loading && !financeReport ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ height: '120px', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '16px', opacity: 0.6 }} />
          ))}
        </div>
      ) : (
        <>
          {/* TAB 1: FINANCE & CASH FLOW */}
          {activeTab === 'finance' && financeReport && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Primary 3 Gates: Оказано (8000), Получено (3000), Долг (5000) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                {/* 1. Оказано */}
                <div
                  data-testid="metric-rendered"
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #BBF7D0',
                    borderRadius: '16px',
                    padding: '20px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>
                      Оказано услуг
                    </span>
                    <span style={{ fontSize: '18px' }}>✓</span>
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#15803D', marginTop: '8px' }}>
                    {formatCurrency(financeReport.rendered_minor)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748B', marginTop: '6px' }}>
                    По закрытым завершённым визитам
                  </div>
                </div>

                {/* 2. Получено */}
                <div
                  data-testid="metric-paid"
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #BFDBFE',
                    borderRadius: '16px',
                    padding: '20px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#1E40AF', textTransform: 'uppercase' }}>
                      Поступления денег
                    </span>
                    <span style={{ fontSize: '18px' }}>💵</span>
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#2563EB', marginTop: '8px' }}>
                    {formatCurrency(financeReport.paid_minor)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748B', marginTop: '6px' }}>
                    Наличные ({formatCurrency(financeReport.cash_inflow_minor)}) + Kaspi ({formatCurrency(financeReport.card_inflow_minor)})
                  </div>
                </div>

                {/* 3. Долг (Дебиторка) */}
                <div
                  data-testid="metric-debt"
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #FECACA',
                    borderRadius: '16px',
                    padding: '20px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#991B1B', textTransform: 'uppercase' }}>
                      Долг клиентов (Дебиторка)
                    </span>
                    <span style={{ fontSize: '18px' }}>⚠️</span>
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: financeReport.debt_minor > 0 ? '#DC2626' : '#15803D', marginTop: '8px' }}>
                    {formatCurrency(financeReport.debt_minor)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748B', marginTop: '6px' }}>
                    Оказано ({formatCurrency(financeReport.rendered_minor)}) - Получено ({formatCurrency(financeReport.paid_minor)})
                  </div>
                </div>

                {/* 4. Расходы салона */}
                <div
                  data-testid="metric-expenses"
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: '16px',
                    padding: '20px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>
                      Расходы салона
                    </span>
                    <span style={{ fontSize: '18px' }}>📉</span>
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#DC2626', marginTop: '8px' }}>
                    {formatCurrency(financeReport.expenses_minor)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748B', marginTop: '6px' }}>
                    Аренда, материалы, хоз. расходы
                  </div>
                </div>

                {/* 5. Чистый денежный поток */}
                <div
                  data-testid="metric-net-cash"
                  style={{
                    background: '#0F172A',
                    color: '#FFFFFF',
                    borderRadius: '16px',
                    padding: '20px',
                    boxShadow: '0 4px 12px rgba(15,23,42,0.15)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase' }}>
                      Чистый денежный поток
                    </span>
                    <span style={{ fontSize: '18px' }}>📊</span>
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: financeReport.net_cash_flow_minor >= 0 ? '#34D399' : '#F87171', marginTop: '8px' }}>
                    {formatCurrency(financeReport.net_cash_flow_minor)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '6px' }}>
                    Поступления - Возвраты - Расходы
                  </div>
                </div>
              </div>

              {/* Secondary Metrics: Returns & Customer Advances */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
                <div data-testid="report-refunds-tile" style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '12px', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#991B1B', textTransform: 'uppercase' }}>Возвраты клиентам (Сторно)</div>
                    <div style={{ fontSize: '11px', color: '#7F1D1D', marginTop: '2px' }}>Учтено отрицательными движениями</div>
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#DC2626' }}>
                    -{formatCurrency(financeReport.refunds_minor)}
                  </div>
                </div>

                <div data-testid="report-advances-tile" style={{ background: '#FAF5FF', border: '1px solid #E9D5FF', borderRadius: '12px', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#6B21A8', textTransform: 'uppercase' }}>Авансы клиентов (Предоплаты)</div>
                    <div style={{ fontSize: '11px', color: '#7E22CE', marginTop: '2px' }}>Отдельно от выручки до завершения визитов</div>
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#7E22CE' }}>
                    +{formatCurrency(financeReport.advances_minor)}
                  </div>
                </div>
              </div>

              {/* Expenses Management Section */}
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '18px', padding: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>
                      Журнал расходов салона ({expenses.length})
                    </h2>
                    <div style={{ fontSize: '12.5px', color: '#64748B', marginTop: '2px' }}>
                      Сумма за период: <b>{formatCurrency(financeReport.expenses_minor)}</b>
                    </div>
                  </div>

                  <button
                    type="button"
                    data-testid="add-expense-btn"
                    onClick={() => setShowExpenseModal(true)}
                    style={{
                      height: '38px',
                      padding: '0 16px',
                      borderRadius: '10px',
                      border: 'none',
                      background: '#DC2626',
                      color: '#FFFFFF',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Plus style={{ width: '16px', height: '16px' }} />
                    Добавить расход
                  </button>
                </div>

                {expenses.length === 0 ? (
                  <div style={{ fontSize: '13.5px', color: '#94A3B8', fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>
                    Расходов за выбранный период не зафиксировано
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table data-testid="expenses-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #E2E8F0', color: '#64748B', fontSize: '12px' }}>
                          <th style={{ padding: '10px 12px' }}>Дата</th>
                          <th style={{ padding: '10px 12px' }}>Категория</th>
                          <th style={{ padding: '10px 12px' }}>Сумма</th>
                          <th style={{ padding: '10px 12px' }}>Счёт / Источник</th>
                          <th style={{ padding: '10px 12px' }}>Автор</th>
                          <th style={{ padding: '10px 12px' }}>Комментарий</th>
                          <th style={{ padding: '10px 12px', textAlign: 'right' }}>Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expenses.map((exp) => (
                          <tr key={exp.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                            <td style={{ padding: '12px', color: '#334155' }}>{exp.expense_date}</td>
                            <td style={{ padding: '12px', fontWeight: 600, color: '#0F172A' }}>{exp.category}</td>
                            <td style={{ padding: '12px', fontWeight: 700, color: '#DC2626' }}>
                              -{formatCurrency(exp.amount_minor)}
                            </td>
                            <td style={{ padding: '12px', color: '#64748B' }}>
                              {exp.payment_method === 'cash' ? '💵 Касса' : '🏦 Расчётный счёт'}
                            </td>
                            <td style={{ padding: '12px', color: '#64748B' }}>{exp.created_by}</td>
                            <td style={{ padding: '12px', color: '#64748B' }}>{exp.comment || '—'}</td>
                            <td style={{ padding: '12px', textAlign: 'right' }}>
                              <button
                                type="button"
                                onClick={() => handleDeleteExpense(exp.id)}
                                title="Удалить расход"
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: '#94A3B8',
                                  cursor: 'pointer',
                                  padding: '4px',
                                }}
                              >
                                <Trash2 style={{ width: '15px', height: '15px' }} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: VISITS REPORT */}
          {activeTab === 'visits' && visitsReport && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
                <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '16px' }}>
                  <div style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>Всего записей</div>
                  <div style={{ fontSize: '26px', fontWeight: 800, color: '#0F172A', marginTop: '4px' }}>{visitsReport.total_bookings}</div>
                </div>
                <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '14px', padding: '16px' }}>
                  <div style={{ fontSize: '11px', color: '#166534', fontWeight: 600, textTransform: 'uppercase' }}>Завершено</div>
                  <div style={{ fontSize: '26px', fontWeight: 800, color: '#15803D', marginTop: '4px' }}>{visitsReport.completed_bookings}</div>
                </div>
                <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '14px', padding: '16px' }}>
                  <div style={{ fontSize: '11px', color: '#1E40AF', fontWeight: 600, textTransform: 'uppercase' }}>В процессе / Прибыл</div>
                  <div style={{ fontSize: '26px', fontWeight: 800, color: '#2563EB', marginTop: '4px' }}>
                    {visitsReport.in_progress_bookings + visitsReport.arrived_bookings}
                  </div>
                </div>
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '14px', padding: '16px' }}>
                  <div style={{ fontSize: '11px', color: '#991B1B', fontWeight: 600, textTransform: 'uppercase' }}>Отменено / No-show</div>
                  <div style={{ fontSize: '26px', fontWeight: 800, color: '#DC2626', marginTop: '4px' }}>
                    {visitsReport.cancelled_bookings + visitsReport.no_show_bookings}
                  </div>
                </div>
                <div style={{ background: '#FAF5FF', border: '1px solid #E9D5FF', borderRadius: '14px', padding: '16px' }}>
                  <div style={{ fontSize: '11px', color: '#6B21A8', fontWeight: 600, textTransform: 'uppercase' }}>Доходимость (Явка)</div>
                  <div style={{ fontSize: '26px', fontWeight: 800, color: '#7E22CE', marginTop: '4px' }}>
                    {visitsReport.completion_rate_percent}%
                  </div>
                </div>
              </div>

              {/* Visits Table */}
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '18px', padding: '24px' }}>
                <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>
                  Детальный список визитов за период ({visitsReport.items.length})
                </h2>

                <div style={{ overflowX: 'auto' }}>
                  <table data-testid="visits-report-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #E2E8F0', color: '#64748B', fontSize: '12px' }}>
                        <th style={{ padding: '10px 12px' }}>Номер</th>
                        <th style={{ padding: '10px 12px' }}>Клиент</th>
                        <th style={{ padding: '10px 12px' }}>Мастер</th>
                        <th style={{ padding: '10px 12px' }}>Услуги</th>
                        <th style={{ padding: '10px 12px' }}>Дата и время</th>
                        <th style={{ padding: '10px 12px' }}>Статус</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Сумма</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visitsReport.items.map((it) => (
                        <tr key={it.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '12px', fontWeight: 600, color: '#2563EB' }}>#{it.public_ref}</td>
                          <td style={{ padding: '12px', fontWeight: 600, color: '#0F172A' }}>{it.customer_name}</td>
                          <td style={{ padding: '12px', color: '#334155' }}>{it.staff_name}</td>
                          <td style={{ padding: '12px', color: '#64748B' }}>{it.services.join(', ')}</td>
                          <td style={{ padding: '12px', color: '#334155' }}>{it.date_display} {it.time_display}</td>
                          <td style={{ padding: '12px' }}>
                            <span style={{
                              padding: '3px 8px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background: it.status === 'completed' ? '#DCFCE7' : it.status === 'cancelled' ? '#FEF2F2' : '#EFF6FF',
                              color: it.status === 'completed' ? '#166534' : it.status === 'cancelled' ? '#991B1B' : '#1D4ED8',
                            }}>
                              {it.status}
                            </span>
                          </td>
                          <td style={{ padding: '12px', fontWeight: 700, color: '#0F172A', textAlign: 'right' }}>
                            {formatCurrency(it.amount_minor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SERVICES REPORT */}
          {activeTab === 'services' && servicesReport && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '18px' }}>
                  <div style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>Оказано услуг (кол-во)</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#0F172A', marginTop: '6px' }}>{servicesReport.total_services_count}</div>
                </div>
                <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '14px', padding: '18px' }}>
                  <div style={{ fontSize: '11px', color: '#166534', fontWeight: 600, textTransform: 'uppercase' }}>Валовая стоимость оказанных услуг</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#15803D', marginTop: '6px' }}>{formatCurrency(servicesReport.total_rendered_minor)}</div>
                </div>
                <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '14px', padding: '18px' }}>
                  <div style={{ fontSize: '11px', color: '#1E40AF', fontWeight: 600, textTransform: 'uppercase' }}>Средний чек услуги</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#2563EB', marginTop: '6px' }}>{formatCurrency(servicesReport.average_ticket_minor)}</div>
                </div>
              </div>

              {/* Services Ranking Table */}
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '18px', padding: '24px' }}>
                <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>
                  Рейтинг услуг по популярности и выручке ({servicesReport.top_services.length})
                </h2>

                <div style={{ overflowX: 'auto' }}>
                  <table data-testid="services-report-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #E2E8F0', color: '#64748B', fontSize: '12px' }}>
                        <th style={{ padding: '10px 12px' }}>#</th>
                        <th style={{ padding: '10px 12px' }}>Наименование услуги</th>
                        <th style={{ padding: '10px 12px' }}>Оказано раз</th>
                        <th style={{ padding: '10px 12px' }}>Выручка</th>
                        <th style={{ padding: '10px 12px' }}>Доля в выручке</th>
                      </tr>
                    </thead>
                    <tbody>
                      {servicesReport.top_services.map((s, idx) => (
                        <tr key={s.service_id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '12px', color: '#94A3B8', fontWeight: 700 }}>{idx + 1}</td>
                          <td style={{ padding: '12px', fontWeight: 600, color: '#0F172A' }}>{s.service_name}</td>
                          <td style={{ padding: '12px', fontWeight: 700, color: '#334155' }}>{s.count}</td>
                          <td style={{ padding: '12px', fontWeight: 700, color: '#059669' }}>{formatCurrency(s.total_minor)}</td>
                          <td style={{ padding: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div style={{ width: '100px', height: '8px', background: '#E2E8F0', borderRadius: '4px', overflow: 'hidden' }}>
                                <div style={{ width: `${s.percentage}%`, height: '100%', background: '#059669' }} />
                              </div>
                              <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748B' }}>{s.percentage}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: DEBTS (ACCOUNTS RECEIVABLE) */}
          {activeTab === 'debts' && debtsReport && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '16px', padding: '20px' }}>
                  <div style={{ fontSize: '12px', color: '#991B1B', fontWeight: 700, textTransform: 'uppercase' }}>
                    Общая дебиторская задолженность
                  </div>
                  <div style={{ fontSize: '32px', fontWeight: 800, color: '#DC2626', marginTop: '6px' }}>
                    {formatCurrency(debtsReport.total_debt_minor)}
                  </div>
                  <div style={{ fontSize: '12px', color: '#7F1D1D', marginTop: '4px' }}>
                    Сумма долгов по всем завершённым визитам
                  </div>
                </div>

                <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '16px', padding: '20px' }}>
                  <div style={{ fontSize: '12px', color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>
                    Количество неоплаченных визитов
                  </div>
                  <div style={{ fontSize: '32px', fontWeight: 800, color: '#0F172A', marginTop: '6px' }}>
                    {debtsReport.debtors_count}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px' }}>
                    Визиты с остатком к доплате &gt; 0
                  </div>
                </div>
              </div>

              {/* Debts Table */}
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '18px', padding: '24px' }}>
                <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>
                  Реестр дебиторской задолженности ({debtsReport.items.length})
                </h2>

                <div style={{ overflowX: 'auto' }}>
                  <table data-testid="debts-report-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #E2E8F0', color: '#64748B', fontSize: '12px' }}>
                        <th style={{ padding: '10px 12px' }}>Визит</th>
                        <th style={{ padding: '10px 12px' }}>Клиент</th>
                        <th style={{ padding: '10px 12px' }}>Телефон</th>
                        <th style={{ padding: '10px 12px' }}>Дата визита</th>
                        <th style={{ padding: '10px 12px' }}>Оказано</th>
                        <th style={{ padding: '10px 12px' }}>Оплачено</th>
                        <th style={{ padding: '10px 12px' }}>Долг</th>
                        <th style={{ padding: '10px 12px' }}>Статус оплаты</th>
                      </tr>
                    </thead>
                    <tbody>
                      {debtsReport.items.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ padding: '32px 16px', textAlign: 'center', color: '#059669', fontWeight: 600 }}>
                            ✓ Задолженностей нет! Все оказанные услуги полностью оплачены.
                          </td>
                        </tr>
                      ) : (
                        debtsReport.items.map((d: DebtItem) => (
                          <tr key={d.booking_id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                            <td style={{ padding: '12px', fontWeight: 600, color: '#2563EB' }}>#{d.public_ref}</td>
                            <td style={{ padding: '12px', fontWeight: 700, color: '#0F172A' }}>{d.customer_name}</td>
                            <td style={{ padding: '12px', color: '#64748B' }}>{d.customer_phone}</td>
                            <td style={{ padding: '12px', color: '#334155' }}>{d.visit_date}</td>
                            <td style={{ padding: '12px', fontWeight: 600 }}>{formatCurrency(d.rendered_minor)}</td>
                            <td style={{ padding: '12px', fontWeight: 600, color: '#2563EB' }}>{formatCurrency(d.paid_minor)}</td>
                            <td style={{ padding: '12px', fontWeight: 800, color: '#DC2626' }}>{formatCurrency(d.debt_minor)}</td>
                            <td style={{ padding: '12px' }}>
                              <span style={{
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: '11px',
                                fontWeight: 700,
                                background: d.payment_status === 'partially_paid' ? '#DBEAFE' : '#FEF2F2',
                                color: d.payment_status === 'partially_paid' ? '#1E40AF' : '#991B1B',
                              }}>
                                {d.payment_status === 'partially_paid' ? 'Частичная оплата' : 'Не оплачено'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Add Expense Modal */}
      {showExpenseModal && (
        <div
          data-testid="expense-modal"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.5)',
            zIndex: 110,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div style={{ width: '100%', maxWidth: '440px', background: '#FFFFFF', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>Добавление расхода</div>
                <div style={{ fontSize: '12px', color: '#64748B' }}>Фиксация затрат бизнеса в журнале</div>
              </div>
              <button type="button" onClick={() => setShowExpenseModal(false)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748B' }}>✕</button>
            </div>

            <form onSubmit={handleAddExpenseSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Категория / статья расхода *
                </label>
                <select
                  data-testid="expense-category-select"
                  value={expenseCategory}
                  onChange={e => setExpenseCategory(e.target.value)}
                  style={{ height: '40px', padding: '0 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px' }}
                >
                  <option value="Материалы и косметика">Материалы и косметика</option>
                  <option value="supplies">Материалы и косметика (supplies)</option>
                  <option value="Аренда помещения">Аренда помещения</option>
                  <option value="Реклама и маркетинг">Реклама и маркетинг</option>
                  <option value="Хозяйственные нужды">Хозяйственные нужды</option>
                  <option value="Коммунальные услуги">Коммунальные услуги</option>
                  <option value="Зарплата / Аванс">Зарплата / Аванс</option>
                  <option value="Прочее">Прочее</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Сумма расхода (₸) *
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  data-testid="expense-amount-input"
                  value={expenseAmountStr}
                  onChange={e => setExpenseAmountStr(e.target.value)}
                  placeholder="2500"
                  required
                  style={{ height: '42px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '16px', fontWeight: 700 }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Дата расхода *
                </label>
                <input
                  type="date"
                  value={expenseDate}
                  onChange={e => setExpenseDate(e.target.value)}
                  required
                  style={{ height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Способ списания *
                </label>
                <select
                  data-testid="expense-method-select"
                  value={expenseMethod}
                  onChange={e => setExpenseMethod(e.target.value as 'cash' | 'account')}
                  style={{ height: '40px', padding: '0 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px' }}
                >
                  <option value="account">🏦 Безналичный расчётный счёт</option>
                  <option value="cash">💵 Наличные из кассы</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Комментарий (опционально)
                </label>
                <input
                  type="text"
                  data-testid="expense-description-input"
                  value={expenseComment}
                  onChange={e => setExpenseComment(e.target.value)}
                  placeholder="Закупка шампуней и гелей"
                  style={{ height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button type="button" onClick={() => setShowExpenseModal(false)} style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFFFFF', cursor: 'pointer' }}>
                  Отмена
                </button>
                <button
                  type="submit"
                  data-testid="confirm-expense-btn"
                  disabled={isSubmittingExpense}
                  style={{ padding: '9px 20px', borderRadius: '8px', border: 'none', background: '#DC2626', color: '#FFFFFF', fontWeight: 700, cursor: isSubmittingExpense ? 'not-allowed' : 'pointer' }}
                >
                  {isSubmittingExpense ? 'Сохранение…' : 'Внести расход'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
