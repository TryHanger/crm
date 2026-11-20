import React, { useState, useEffect } from 'react';
import {
  BusinessCrmApiClient,
  CashShift,
  CashShiftSummary,
  PaymentMethod,
} from '@crm/api-client';

interface CashModuleProps {
  api: BusinessCrmApiClient;
  token: string;
  tenantId: string;
  branchId: string;
  userRole: string;
  onShowToast: (msg: string) => void;
}

export const CashModule: React.FC<CashModuleProps> = ({
  api,
  token,
  tenantId,
  branchId,
  userRole,
  onShowToast,
}) => {
  const [shiftSummary, setShiftSummary] = useState<CashShiftSummary | null>(null);
  const [shiftsHistory, setShiftsHistory] = useState<CashShift[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Modals
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openBalanceStr, setOpenBalanceStr] = useState('10000');
  const [openComment, setOpenComment] = useState('');
  const [isOpening, setIsOpening] = useState(false);

  const [showCloseModal, setShowCloseModal] = useState(false);
  const [actualCashStr, setActualCashStr] = useState('');
  const [closeComment, setCloseComment] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [advanceCustomerId, setAdvanceCustomerId] = useState('');
  const [advanceCustomerName, setAdvanceCustomerName] = useState('');
  const [advanceAmountStr, setAdvanceAmountStr] = useState('2000');
  const [advanceMethod, setAdvanceMethod] = useState<PaymentMethod>('cash');
  const [advanceComment, setAdvanceComment] = useState('');
  const [isSubmittingAdvance, setIsSubmittingAdvance] = useState(false);

  const isMaster = userRole === 'master';

  const loadData = React.useCallback(async () => {
    if (!token || !tenantId || !branchId) return;
    try {
      setIsLoading(true);
      const [curr, history, custs] = await Promise.all([
        api.getCurrentCashShift(branchId, token, tenantId),
        api.getCashShifts(branchId, token, tenantId),
        api.getCustomers({}, token, tenantId).catch(() => []),
      ]);
      setShiftSummary(curr);
      setShiftsHistory(history || []);
      setCustomers(Array.isArray(custs) ? custs : []);
      if (curr) {
        setActualCashStr((curr.expected_cash_balance_minor / 100).toString());
      }
    } catch (err: any) {
      console.error('Failed to load cash shifts:', err);
    } finally {
      setIsLoading(false);
    }
  }, [api, branchId, token, tenantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Open Shift
  const handleOpenShiftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const balance = parseFloat(openBalanceStr);
    if (isNaN(balance) || balance < 0) {
      onShowToast('Введите корректный остаток на начало смены');
      return;
    }
    try {
      setIsOpening(true);
      let effectiveBranchId = branchId;
      if (!effectiveBranchId) {
        const bList = await api.getBranches(token, tenantId);
        effectiveBranchId = bList?.[0]?.id || '';
      }
      if (!effectiveBranchId) {
        throw new Error('Филиал не выбран');
      }
      await api.openCashShift(
        {
          branch_id: effectiveBranchId,
          opened_by: userRole === 'owner' ? 'Владелец' : 'Администратор',
          opening_balance_minor: Math.round(balance * 100),
          comment: openComment.trim() || undefined,
        },
        token,
        tenantId
      );
      onShowToast('Кассовая смена успешно открыта');
      setShowOpenModal(false);
      setOpenComment('');
      loadData();
    } catch (err: any) {
      onShowToast(`Ошибка открытия смены: ${err.message || err}`);
    } finally {
      setIsOpening(false);
    }
  };

  // Handle Close Shift
  const handleCloseShiftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shiftSummary) return;
    const actual = parseFloat(actualCashStr);
    if (isNaN(actual) || actual < 0) {
      onShowToast('Введите фактическую сумму наличных в кассе');
      return;
    }
    try {
      setIsClosing(true);
      await api.closeCashShift(
        {
          shift_id: shiftSummary.shift.id,
          closed_by: userRole === 'owner' ? 'Владелец' : 'Администратор',
          closing_cash_actual_minor: Math.round(actual * 100),
          comment: closeComment.trim() || undefined,
        },
        token,
        tenantId
      );
      onShowToast('Кассовая смена успешно закрыта (Z-отчёт зафиксирован)');
      setShowCloseModal(false);
      setCloseComment('');
      loadData();
    } catch (err: any) {
      onShowToast(`Ошибка закрытия смены: ${err.message || err}`);
    } finally {
      setIsClosing(false);
    }
  };

  // Handle Register Advance (real M13 POST /customers/{id}/advances)
  const handleAdvanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(advanceAmountStr);
    if (isNaN(amount) || amount <= 0) {
      onShowToast('Введите корректную сумму аванса');
      return;
    }
    if (!advanceCustomerId && !advanceCustomerName.trim()) {
      onShowToast('Выберите или укажите клиента для внесения аванса');
      return;
    }
    try {
      setIsSubmittingAdvance(true);
      let targetCustomerId = advanceCustomerId;
      if (!targetCustomerId) {
        const raw = advanceCustomerName.trim();
        const phoneMatch = raw.match(/\+?\d[\d\s\-()]{8,}/);
        const extractedPhone = phoneMatch ? phoneMatch[0].replace(/[^\d+]/g, '') : '';
        const cleanName = raw.replace(/\(?\+?\d[\d\s\-()]{8,}\)?/, '').trim() || raw;
        const found = customers.find(
          (c: any) =>
            (extractedPhone && c.phone_e164 && c.phone_e164.replace(/\D/g, '').endsWith(extractedPhone.replace(/\D/g, '').slice(-10))) ||
            (c.full_name && c.full_name.toLowerCase() === cleanName.toLowerCase())
        );
        if (found) {
          targetCustomerId = found.id;
        } else {
          const created: any = await api.createCustomer(
            {
              full_name: cleanName,
              phone_e164: extractedPhone || `+7701${Math.floor(1000000 + Math.random() * 8999999)}`,
              confirm_shared_phone: true,
            } as any,
            token,
            tenantId
          );
          targetCustomerId = created.id || created.existing_customer_id;
        }
      }
      if (!targetCustomerId) {
        throw new Error('Не удалось определить клиента для аванса');
      }
      const idempotencyKey = `adv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await api.createCustomerAdvance(
        targetCustomerId,
        {
          branch_id: branchId,
          amount_minor: Math.round(amount * 100),
          payment_method: advanceMethod === 'advance' ? 'cash' : advanceMethod,
          note: advanceComment.trim() || `Аванс: ${advanceCustomerName.trim()}`,
        },
        token,
        tenantId,
        idempotencyKey
      );
      onShowToast(`Аванс ${(amount).toLocaleString('ru-RU')} ₸ успешно принят`);
      setShowAdvanceModal(false);
      setAdvanceCustomerId('');
      setAdvanceCustomerName('');
      setAdvanceComment('');
      loadData();
    } catch (err: any) {
      onShowToast(`Ошибка внесения аванса: ${err.message || err}`);
    } finally {
      setIsSubmittingAdvance(false);
    }
  };

  if (isMaster) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', background: '#F8FAFC', borderRadius: '16px', border: '1px solid #E2E8F0' }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔒</div>
        <div style={{ fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>Доступ ограничен</div>
        <div style={{ fontSize: '14px', color: '#64748B', marginTop: '6px' }}>
          Кассовые смены и финансовые операции доступны только владельцу и администратору.
        </div>
      </div>
    );
  }

  const currentShift = shiftSummary?.shift;
  const isShiftOpen = Boolean(currentShift && currentShift.status === 'open');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: '#0F172A' }}>Касса и смены</h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#64748B' }}>
            Управление кассовыми сменами, учёт наличности, авансов и reconciliation Z-отчётов
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          {isShiftOpen ? (
            <>
              <button
                type="button"
                data-testid="add-advance-btn"
                onClick={() => setShowAdvanceModal(true)}
                style={{
                  height: '40px',
                  padding: '0 16px',
                  borderRadius: '10px',
                  border: '1px solid #3B82F6',
                  background: '#EFF6FF',
                  color: '#1D4ED8',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                💳 Внести аванс клиента
              </button>

              <button
                type="button"
                data-testid="close-shift-btn"
                onClick={() => {
                  if (shiftSummary) {
                    setActualCashStr((shiftSummary.expected_cash_balance_minor / 100).toString());
                  }
                  setShowCloseModal(true);
                }}
                style={{
                  height: '40px',
                  padding: '0 18px',
                  borderRadius: '10px',
                  border: 'none',
                  background: '#DC2626',
                  color: '#FFFFFF',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                🔒 Закрыть смену (Z-отчёт)
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid="open-shift-btn"
              onClick={() => setShowOpenModal(true)}
              style={{
                height: '40px',
                padding: '0 18px',
                borderRadius: '10px',
                border: 'none',
                background: '#059669',
                color: '#FFFFFF',
                fontSize: '13.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              🔓 Открыть кассовую смену
            </button>
          )}
        </div>
      </div>

      {/* Current Shift Status Card */}
      {isShiftOpen && shiftSummary ? (
        <div
          data-testid="active-shift-card"
          style={{
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: '18px',
            padding: '24px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                data-testid="shift-status-badge"
                style={{
                  padding: '4px 10px',
                  borderRadius: '8px',
                  background: '#DCFCE7',
                  color: '#166534',
                  border: '1px solid #86EFAC',
                  fontSize: '12px',
                  fontWeight: 700,
                }}
              >
                ● Смена открыта
              </span>
              <span style={{ fontSize: '13px', color: '#64748B' }}>
                Открыл: <b>{currentShift?.opened_by}</b> • {new Date(currentShift?.opened_at || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            <div style={{ fontSize: '13px', color: '#64748B' }}>
              Операций за смену: <b>{shiftSummary.transactions_count}</b>
            </div>
          </div>

          {/* 5 Financial Shift Tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            {/* 1. Opening Balance */}
            <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>
                Размен на начало
              </div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: '#0F172A', marginTop: '4px' }}>
                {((currentShift?.opening_balance_minor || 0) / 100).toLocaleString('ru-RU')} ₸
              </div>
              <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>Внесено при открытии</div>
            </div>

            {/* 2. Cash Inflow */}
            <div style={{ background: '#F0FDF4', padding: '16px', borderRadius: '12px', border: '1px solid #BBF7D0' }}>
              <div style={{ fontSize: '11px', color: '#166534', fontWeight: 600, textTransform: 'uppercase' }}>
                Поступления наличными
              </div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: '#15803D', marginTop: '4px' }}>
                +{(shiftSummary.cash_inflow_minor / 100).toLocaleString('ru-RU')} ₸
              </div>
              <div style={{ fontSize: '11px', color: '#16A34A', marginTop: '2px' }}>Оплаты наличными в кассу</div>
            </div>

            {/* 3. Cash Refunds */}
            <div style={{ background: '#FEF2F2', padding: '16px', borderRadius: '12px', border: '1px solid #FECACA' }}>
              <div style={{ fontSize: '11px', color: '#991B1B', fontWeight: 600, textTransform: 'uppercase' }}>
                Возвраты наличными
              </div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: '#DC2626', marginTop: '4px' }}>
                -{(shiftSummary.cash_refund_minor / 100).toLocaleString('ru-RU')} ₸
              </div>
              <div style={{ fontSize: '11px', color: '#B91C1C', marginTop: '2px' }}>Сторно / возврат клиентам</div>
            </div>

            {/* 4. Non-cash / Kaspi */}
            <div style={{ background: '#EFF6FF', padding: '16px', borderRadius: '12px', border: '1px solid #BFDBFE' }}>
              <div style={{ fontSize: '11px', color: '#1E40AF', fontWeight: 600, textTransform: 'uppercase' }}>
                Безналичные / Kaspi
              </div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: '#2563EB', marginTop: '4px' }}>
                +{(shiftSummary.card_inflow_minor / 100).toLocaleString('ru-RU')} ₸
              </div>
              <div style={{ fontSize: '11px', color: '#2563EB', marginTop: '2px' }}>Переводы и терминал</div>
            </div>

            {/* 5. Advances (Separated from revenue!) */}
            <div style={{ background: '#FAF5FF', padding: '16px', borderRadius: '12px', border: '1px solid #E9D5FF' }}>
              <div style={{ fontSize: '11px', color: '#6B21A8', fontWeight: 600, textTransform: 'uppercase' }}>
                Авансы клиентов
              </div>
              <div
                data-testid="shift-advances-stat"
                style={{ fontSize: '22px', fontWeight: 800, color: '#7E22CE', marginTop: '4px' }}
              >
                +{(shiftSummary.advance_inflow_minor / 100).toLocaleString('ru-RU')} ₸
              </div>
              <div style={{ fontSize: '11px', color: '#7E22CE', marginTop: '2px' }}>Отдельно от выручки</div>
            </div>
          </div>

          {/* Expected Cash in Register Banner */}
          <div
            data-testid="expected-cash-banner"
            style={{
              background: '#0F172A',
              color: '#FFFFFF',
              borderRadius: '14px',
              padding: '16px 20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Расчётный остаток наличных в кассе (на пересчёт)
              </div>
              <div style={{ fontSize: '13px', color: '#CBD5E1', marginTop: '2px' }}>
                Размен ({((currentShift?.opening_balance_minor || 0) / 100).toLocaleString('ru-RU')} ₸) + Наличные ({(shiftSummary.cash_inflow_minor / 100).toLocaleString('ru-RU')} ₸) - Возвраты ({(shiftSummary.cash_refund_minor / 100).toLocaleString('ru-RU')} ₸)
              </div>
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#34D399' }}>
              {(shiftSummary.expected_cash_balance_minor / 100).toLocaleString('ru-RU')} ₸
            </div>
          </div>
        </div>
      ) : (
        <div
          data-testid="shift-closed-banner"
          style={{
            background: '#F8FAFC',
            border: '2px dashed #CBD5E1',
            borderRadius: '18px',
            padding: '36px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div style={{ fontSize: '36px' }}>🔒</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>Кассовая смена закрыта</div>
          <div style={{ fontSize: '14px', color: '#64748B', maxWidth: '440px' }}>
            Чтобы регистрировать оплаты наличными, переводы и авансы, откройте новую кассовую смену и внесите начальный размен.
          </div>
          <button
            type="button"
            data-testid="open-shift-prompt-btn"
            onClick={() => setShowOpenModal(true)}
            style={{
              marginTop: '8px',
              height: '42px',
              padding: '0 24px',
              borderRadius: '10px',
              border: 'none',
              background: '#059669',
              color: '#FFFFFF',
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            🔓 Открыть смену сейчас
          </button>
        </div>
      )}

      {/* Shifts History */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '18px', padding: '24px' }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>
          История кассовых смен ({shiftsHistory.length})
        </h2>

        {shiftsHistory.length === 0 ? (
          <div style={{ fontSize: '14px', color: '#94A3B8', fontStyle: 'italic', padding: '16px 0' }}>
            История смен пуста
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table data-testid="shifts-history-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #E2E8F0', color: '#64748B', fontSize: '12px' }}>
                  <th style={{ padding: '10px 12px' }}>Статус</th>
                  <th style={{ padding: '10px 12px' }}>Открытие</th>
                  <th style={{ padding: '10px 12px' }}>Размен</th>
                  <th style={{ padding: '10px 12px' }}>Закрытие</th>
                  <th style={{ padding: '10px 12px' }}>Факт в кассе</th>
                  <th style={{ padding: '10px 12px' }}>Расхождение</th>
                  <th style={{ padding: '10px 12px' }}>Кассир</th>
                </tr>
              </thead>
              <tbody>
                {shiftsHistory.map((s) => {
                  const isOpen = s.status === 'open';
                  const diff = s.difference_minor ?? 0;
                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '12px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: isOpen ? '#DCFCE7' : '#F1F5F9',
                            color: isOpen ? '#166534' : '#475569',
                          }}
                        >
                          {isOpen ? 'Открыта' : 'Закрыта'}
                        </span>
                      </td>
                      <td style={{ padding: '12px', color: '#334155' }}>
                        {new Date(s.opened_at).toLocaleDateString('ru-RU')} {new Date(s.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ padding: '12px', fontWeight: 600 }}>
                        {(s.opening_balance_minor / 100).toLocaleString('ru-RU')} ₸
                      </td>
                      <td style={{ padding: '12px', color: '#64748B' }}>
                        {s.closed_at ? `${new Date(s.closed_at).toLocaleDateString('ru-RU')} ${new Date(s.closed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '—'}
                      </td>
                      <td style={{ padding: '12px', fontWeight: 700, color: '#0F172A' }}>
                        {s.closing_cash_actual_minor != null ? `${(s.closing_cash_actual_minor / 100).toLocaleString('ru-RU')} ₸` : '—'}
                      </td>
                      <td style={{ padding: '12px' }}>
                        {s.closing_cash_actual_minor != null ? (
                          diff === 0 ? (
                            <span style={{ color: '#059669', fontWeight: 700 }}>✓ 0 ₸ (Сошлось)</span>
                          ) : diff > 0 ? (
                            <span style={{ color: '#D97706', fontWeight: 700 }}>+{(diff / 100).toLocaleString('ru-RU')} ₸ (Излишек)</span>
                          ) : (
                            <span style={{ color: '#DC2626', fontWeight: 700 }}>{(diff / 100).toLocaleString('ru-RU')} ₸ (Недостача)</span>
                          )
                        ) : '—'}
                      </td>
                      <td style={{ padding: '12px', color: '#64748B' }}>
                        {s.closed_by || s.opened_by}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Open Shift Modal */}
      {showOpenModal && (
        <div
          data-testid="open-shift-modal"
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
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>Открытие кассовой смены</div>
              <button type="button" onClick={() => setShowOpenModal(false)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748B' }}>✕</button>
            </div>

            <form onSubmit={handleOpenShiftSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Разменный фонд / остаток на начало (₸) *
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  data-testid="opening-balance-input"
                  value={openBalanceStr}
                  onChange={e => setOpenBalanceStr(e.target.value)}
                  placeholder="10000"
                  required
                  style={{ height: '42px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '16px', fontWeight: 700 }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Комментарий (опционально)
                </label>
                <input
                  type="text"
                  value={openComment}
                  onChange={e => setOpenComment(e.target.value)}
                  placeholder="Размен выдан из сейфа"
                  style={{ height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button type="button" onClick={() => setShowOpenModal(false)} style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFFFFF', cursor: 'pointer' }}>
                  Отмена
                </button>
                <button
                  type="submit"
                  data-testid="confirm-open-shift-btn"
                  disabled={isOpening}
                  style={{ padding: '9px 20px', borderRadius: '8px', border: 'none', background: '#059669', color: '#FFFFFF', fontWeight: 700, cursor: isOpening ? 'not-allowed' : 'pointer' }}
                >
                  {isOpening ? 'Открытие…' : 'Открыть смену'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Close Shift Modal (Z-Отчёт) */}
      {showCloseModal && shiftSummary && (
        <div
          data-testid="close-shift-modal"
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
          <div style={{ width: '100%', maxWidth: '460px', background: '#FFFFFF', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#DC2626' }}>Закрытие смены (Z-отчёт)</div>
                <div style={{ fontSize: '12px', color: '#64748B' }}>Сверка расчётного и фактического остатка в кассе</div>
              </div>
              <button type="button" onClick={() => setShowCloseModal(false)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748B' }}>✕</button>
            </div>

            <form onSubmit={handleCloseShiftSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Expected vs Actual Box */}
              <div style={{ background: '#F8FAFC', padding: '14px', borderRadius: '12px', border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: '#64748B' }}>Расчётная сумма в кассе:</span>
                  <span style={{ fontWeight: 800, color: '#0F172A' }}>
                    {(shiftSummary.expected_cash_balance_minor / 100).toLocaleString('ru-RU')} ₸
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                    Фактический остаток наличных (пересчёт) *
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    data-testid="actual-cash-input"
                    value={actualCashStr}
                    onChange={e => setActualCashStr(e.target.value)}
                    required
                    style={{ height: '42px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '16px', fontWeight: 800 }}
                  />
                </div>

                {/* Live Reconciliation Difference */}
                {actualCashStr && !isNaN(parseFloat(actualCashStr)) && (() => {
                  const actualMinor = Math.round(parseFloat(actualCashStr) * 100);
                  const diff = actualMinor - shiftSummary.expected_cash_balance_minor;
                  return (
                    <div
                      data-testid="cash-difference"
                      style={{
                        marginTop: '6px',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: 700,
                        background: diff === 0 ? '#DCFCE7' : diff > 0 ? '#FEF3C7' : '#FEE2E2',
                        color: diff === 0 ? '#166534' : diff > 0 ? '#92400E' : '#991B1B',
                      }}
                    >
                      {diff === 0 && '✓ Расхождений нет (Касса сходится)'}
                      {diff > 0 && `Излишек: +${(diff / 100).toLocaleString('ru-RU')} ₸`}
                      {diff < 0 && `Недостача: ${(diff / 100).toLocaleString('ru-RU')} ₸`}
                    </div>
                  );
                })()}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Акт закрытия / комментарий (опционально)
                </label>
                <input
                  type="text"
                  value={closeComment}
                  onChange={e => setCloseComment(e.target.value)}
                  placeholder="Всё пересчитано, купюры проверены"
                  style={{ height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button type="button" onClick={() => setShowCloseModal(false)} style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFFFFF', cursor: 'pointer' }}>
                  Отмена
                </button>
                <button
                  type="submit"
                  data-testid="confirm-close-shift-btn"
                  disabled={isClosing}
                  style={{ padding: '9px 20px', borderRadius: '8px', border: 'none', background: '#DC2626', color: '#FFFFFF', fontWeight: 700, cursor: isClosing ? 'not-allowed' : 'pointer' }}
                >
                  {isClosing ? 'Закрытие смены…' : 'Зафиксировать Z-отчёт'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Advance Modal */}
      {showAdvanceModal && (
        <div
          data-testid="advance-modal"
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
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>Внесение аванса клиента</div>
                <div style={{ fontSize: '12px', color: '#64748B' }}>Предоплата / депозит на будущие визиты</div>
              </div>
              <button type="button" onClick={() => setShowAdvanceModal(false)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748B' }}>✕</button>
            </div>

            <form onSubmit={handleAdvanceSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Клиент *
                </label>
                {customers.length > 0 && (
                  <select
                    data-testid="advance-customer-select"
                    value={advanceCustomerId}
                    onChange={e => {
                      setAdvanceCustomerId(e.target.value);
                      const c = customers.find((x: any) => x.id === e.target.value);
                      if (c) setAdvanceCustomerName(`${c.full_name} (${c.phone_e164})`);
                    }}
                    style={{ height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px', background: '#FFFFFF' }}
                  >
                    <option value="">— Выбрать из базы или ввести ниже —</option>
                    {customers.map((c: any) => (
                      <option key={c.id} value={c.id}>{c.full_name} ({c.phone_e164})</option>
                    ))}
                  </select>
                )}
                <input
                  type="text"
                  data-testid="advance-customer-input"
                  value={advanceCustomerName}
                  onChange={e => {
                    setAdvanceCustomerName(e.target.value);
                    setAdvanceCustomerId('');
                  }}
                  placeholder="Асет Калиев (+7701...)"
                  required={!advanceCustomerId}
                  style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '14px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Сумма аванса (₸) *
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  data-testid="advance-amount-input"
                  value={advanceAmountStr}
                  onChange={e => setAdvanceAmountStr(e.target.value)}
                  placeholder="2000"
                  required
                  style={{ height: '42px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '16px', fontWeight: 700 }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Способ приёма *
                </label>
                <select
                  value={advanceMethod}
                  onChange={e => setAdvanceMethod(e.target.value as PaymentMethod)}
                  style={{ height: '40px', padding: '0 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '14px' }}
                >
                  <option value="cash">Наличные</option>
                  <option value="external_transfer">Kaspi / QR перевод</option>
                  <option value="card">Карта / Терминал</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Комментарий (опционально)
                </label>
                <input
                  type="text"
                  value={advanceComment}
                  onChange={e => setAdvanceComment(e.target.value)}
                  placeholder="Предоплата на пятницу"
                  style={{ height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button type="button" onClick={() => setShowAdvanceModal(false)} style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFFFFF', cursor: 'pointer' }}>
                  Отмена
                </button>
                <button
                  type="submit"
                  data-testid="submit-advance-btn"
                  disabled={isSubmittingAdvance}
                  style={{ padding: '9px 20px', borderRadius: '8px', border: 'none', background: '#2563EB', color: '#FFFFFF', fontWeight: 700, cursor: isSubmittingAdvance ? 'not-allowed' : 'pointer' }}
                >
                  {isSubmittingAdvance ? 'Внесение…' : 'Внести аванс'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
