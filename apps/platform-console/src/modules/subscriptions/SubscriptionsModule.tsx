import React, { useState, useEffect } from 'react';
import {
  PlatformApiClient,
  PlatformSubscriptionItem,
  PlatformChargeItem,
} from '@crm/api-client';
import { PlatformRole } from '../../types';

interface SubscriptionsModuleProps {
  api: PlatformApiClient;
  token: string;
  userRole: PlatformRole;
  showToast: (msg: string) => void;
}

export const SubscriptionsModule: React.FC<SubscriptionsModuleProps> = ({
  api,
  token,
  userRole,
  showToast,
}) => {
  const [activeTab, setActiveTab] = useState<'subs' | 'charges'>('subs');

  // Subscriptions state
  const [subs, setSubs] = useState<PlatformSubscriptionItem[]>([]);
  const [isLoadingSubs, setIsLoadingSubs] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Charges state
  const [charges, setCharges] = useState<PlatformChargeItem[]>([]);
  const [isLoadingCharges, setIsLoadingCharges] = useState(false);
  const [chargeStatusFilter, setChargeStatusFilter] = useState('');

  // Modal: Renew Subscription
  const [selectedSub, setSelectedSub] = useState<PlatformSubscriptionItem | null>(null);
  const [renewDays, setRenewDays] = useState(30);
  const [renewRecordPayment, setRenewRecordPayment] = useState(false);
  const [renewAmount, setRenewAmount] = useState<number>(0);
  const [renewEvidence, setRenewEvidence] = useState('');
  const [renewPaymentMethod, setRenewPaymentMethod] = useState('bank_transfer');
  const [isSubmittingRenew, setIsSubmittingRenew] = useState(false);

  // Modal: Record Payment for Charge
  const [selectedCharge, setSelectedCharge] = useState<PlatformChargeItem | null>(null);
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState<string>('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentEvidence, setPaymentEvidence] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [paymentNote, setPaymentNote] = useState('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  const canManageBilling = ['platform_owner', 'finance'].includes(userRole);

  const loadSubscriptions = async () => {
    setIsLoadingSubs(true);
    try {
      const res = await api.getSubscriptions(
        {
          status_filter: statusFilter || undefined,
          query: searchQuery || undefined,
        },
        token
      );
      setSubs(res);
    } catch (err: any) {
      showToast(err.message || 'Ошибка загрузки списка подписок');
    } finally {
      setIsLoadingSubs(false);
    }
  };

  const loadCharges = async () => {
    setIsLoadingCharges(true);
    try {
      const res = await api.getCharges(
        {
          status_filter: chargeStatusFilter || undefined,
        },
        token
      );
      setCharges(res);
    } catch (err: any) {
      showToast(err.message || 'Ошибка загрузки счетов');
    } finally {
      setIsLoadingCharges(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'subs') {
      loadSubscriptions();
    } else {
      loadCharges();
    }
  }, [token, activeTab, statusFilter, chargeStatusFilter]);

  const handleOpenRenewModal = (sub: PlatformSubscriptionItem) => {
    setSelectedSub(sub);
    setRenewDays(30);
    // Default: extend access only without automatic payment confirmation
    setRenewRecordPayment(false);
    setRenewAmount(sub.price_minor / 100);
    setRenewEvidence('');
    setRenewPaymentMethod('bank_transfer');
  };

  const handleSubmitRenew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSub) return;
    setIsSubmittingRenew(true);
    try {
      await api.renewSubscription(
        selectedSub.id,
        {
          extend_days: renewDays,
          record_payment: renewRecordPayment,
          amount_minor: renewRecordPayment ? Math.round(renewAmount * 100) : undefined,
          evidence_reference: renewRecordPayment ? renewEvidence.trim() : undefined,
          payment_method: renewPaymentMethod,
        },
        token
      );
      showToast(`Подписка ${selectedSub.tenant_name} успешно продлена на ${renewDays} дней`);
      setSelectedSub(null);
      await loadSubscriptions();
    } catch (err: any) {
      showToast(err.message || 'Ошибка продления подписки');
    } finally {
      setIsSubmittingRenew(false);
    }
  };

  const handleOpenPaymentModal = (ch: PlatformChargeItem) => {
    setSelectedCharge(ch);
    // calculate remaining unpaid balance
    const totalPaid = ch.payments.reduce((acc, p) => acc + p.amount_minor, 0);
    const balance = Math.max(0, (ch.amount_minor - totalPaid) / 100);
    setPaymentAmount(balance);
    setPaymentEvidence('');
    setPaymentMethod('bank_transfer');
    setPaymentNote('Оплата по выставленному счёту');
    const stableKey = `pmt_${ch.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setPaymentIdempotencyKey(stableKey);
    setPaymentError(null);
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCharge || !paymentEvidence.trim()) {
      showToast('Укажите референс платёжного документа');
      return;
    }
    setIsSubmittingPayment(true);
    setPaymentError(null);
    try {
      const idempotencyKey = paymentIdempotencyKey || `pmt_${selectedCharge.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (!paymentIdempotencyKey) {
        setPaymentIdempotencyKey(idempotencyKey);
      }
      await api.recordPayment(
        selectedCharge.id,
        {
          amount_minor: Math.round(paymentAmount * 100),
          evidence_reference: paymentEvidence.trim(),
          payment_method: paymentMethod,
          note: paymentNote.trim() || undefined,
        },
        token,
        idempotencyKey
      );
      showToast(`Платёж на ${(paymentAmount).toLocaleString('ru-RU')} ₸ успешно зафиксирован`);
      setSelectedCharge(null);
      setPaymentIdempotencyKey('');
      setPaymentError(null);
      await loadCharges();
    } catch (err: any) {
      const msg = err.message || 'Ошибка фиксации платежа';
      setPaymentError(msg);
      showToast(msg);
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* VIEW TABS BAR */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '12px',
          padding: '16px 20px',
          border: '1px solid #E2E8F0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('subs')}
            data-testid="tab-subscriptions"
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: activeTab === 'subs' ? '#2563EB' : '#F1F5F9',
              color: activeTab === 'subs' ? '#FFFFFF' : '#475569',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            📋 Список подписок
          </button>
          <button
            onClick={() => setActiveTab('charges')}
            data-testid="tab-charges"
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: activeTab === 'charges' ? '#2563EB' : '#F1F5F9',
              color: activeTab === 'charges' ? '#FFFFFF' : '#475569',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            🧾 Книга счетов и оплат (Ledger)
          </button>
        </div>

        {activeTab === 'subs' && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadSubscriptions()}
              placeholder="Поиск по компании..."
              style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px' }}
            />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              data-testid="subs-status-filter"
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px' }}
            >
              <option value="">Все статусы</option>
              <option value="active">Активные</option>
              <option value="trial">Пробные (Trial)</option>
              <option value="grace">Льготный период (Grace)</option>
              <option value="pending_suspension">Ожидающие приостановки</option>
              <option value="suspended">Приостановленные</option>
            </select>
          </div>
        )}

        {activeTab === 'charges' && (
          <select
            value={chargeStatusFilter}
            onChange={e => setChargeStatusFilter(e.target.value)}
            data-testid="charges-status-filter"
            style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px' }}
          >
            <option value="">Все статусы счетов</option>
            <option value="issued">Ожидают оплаты</option>
            <option value="partially_paid">Частично оплачены</option>
            <option value="paid">Полностью оплачены</option>
          </select>
        )}
      </div>

      {/* TAB 1: SUBSCRIPTIONS LIST */}
      {activeTab === 'subs' && (
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: '12px',
            border: '1px solid #E2E8F0',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table
              data-testid="subscriptions-table"
              style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', color: '#64748B' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Компания</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Тарифный план</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Статус</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Окончание периода</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Льготный период</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Действие</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingSubs ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '30px', textAlign: 'center', color: '#64748B' }}>
                      Загрузка подписок...
                    </td>
                  </tr>
                ) : subs.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '30px', textAlign: 'center', color: '#64748B' }}>
                      Подписки не найдены.
                    </td>
                  </tr>
                ) : (
                  subs.map(sub => (
                    <tr
                      key={sub.id}
                      data-testid={`sub-row-${sub.tenant_slug}`}
                      style={{ borderBottom: '1px solid #F1F5F9' }}
                    >
                      <td style={{ padding: '14px 16px' }}>
                        <b style={{ color: '#0F172A', display: 'block' }}>{sub.tenant_name}</b>
                        <span style={{ fontSize: '11px', color: '#94A3B8' }}>{sub.tenant_slug}</span>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <b>{sub.plan_name}</b>
                        <div style={{ fontSize: '12px', color: '#64748B' }}>
                          {(sub.price_minor / 100).toLocaleString('ru-RU')} {sub.currency} / мес.
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background:
                              sub.lifecycle_status === 'active'
                                ? '#DCFCE7'
                                : sub.lifecycle_status === 'trial'
                                ? '#DBEAFE'
                                : sub.lifecycle_status === 'grace'
                                ? '#FEF3C7'
                                : '#FEE2E2',
                            color:
                              sub.lifecycle_status === 'active'
                                ? '#166534'
                                : sub.lifecycle_status === 'trial'
                                ? '#1D4ED8'
                                : sub.lifecycle_status === 'grace'
                                ? '#92400E'
                                : '#991B1B',
                          }}
                        >
                          {sub.lifecycle_status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', color: '#0F172A', fontWeight: 500 }}>
                        {new Date(sub.period_end).toLocaleDateString('ru-RU')}
                      </td>
                      <td style={{ padding: '14px 16px', color: '#64748B', fontSize: '12px' }}>
                        {sub.grace_ends_at ? new Date(sub.grace_ends_at).toLocaleDateString('ru-RU') : '—'}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        {canManageBilling && (
                          <button
                            onClick={() => handleOpenRenewModal(sub)}
                            data-testid={`renew-sub-btn-${sub.tenant_slug}`}
                            style={{
                              padding: '6px 12px',
                              background: '#2563EB',
                              color: '#FFFFFF',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Продлить подписку
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: CHARGES LEDGER */}
      {activeTab === 'charges' && (
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: '12px',
            border: '1px solid #E2E8F0',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table
              data-testid="charges-table"
              style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', color: '#64748B' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Компания</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Период счёта</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Сумма</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Статус</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Оплачено / Платежи</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Действие</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingCharges ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '30px', textAlign: 'center', color: '#64748B' }}>
                      Загрузка счетов...
                    </td>
                  </tr>
                ) : charges.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '30px', textAlign: 'center', color: '#64748B' }}>
                      Счета не найдены.
                    </td>
                  </tr>
                ) : (
                  charges.map(ch => {
                    const totalPaid = ch.payments.reduce((acc, p) => acc + p.amount_minor, 0);
                    const isFullyPaid = ch.charge_status === 'paid';
                    return (
                      <tr key={ch.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '14px 16px' }}>
                          <b style={{ color: '#0F172A' }}>{ch.tenant_name}</b>
                          {ch.evidence_reference && (
                            <div style={{ fontSize: '11px', color: '#64748B' }}>{ch.evidence_reference}</div>
                          )}
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: '12px', color: '#475569' }}>
                          {new Date(ch.period_start).toLocaleDateString('ru-RU')} —{' '}
                          {new Date(ch.period_end).toLocaleDateString('ru-RU')}
                        </td>
                        <td style={{ padding: '14px 16px', fontWeight: 700, color: '#0F172A' }}>
                          {(ch.amount_minor / 100).toLocaleString('ru-RU')} {ch.currency}
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: 600,
                              background:
                                isFullyPaid
                                  ? '#DCFCE7'
                                  : ch.charge_status === 'partially_paid'
                                  ? '#FEF3C7'
                                  : '#FEE2E2',
                              color:
                                isFullyPaid
                                  ? '#166534'
                                  : ch.charge_status === 'partially_paid'
                                  ? '#92400E'
                                  : '#991B1B',
                            }}
                          >
                            {isFullyPaid
                              ? 'Оплачен'
                              : ch.charge_status === 'partially_paid'
                              ? 'Частично оплачен'
                              : 'Выставлен'}
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: '12px' }}>
                          <b>{(totalPaid / 100).toLocaleString('ru-RU')} ₸</b>
                          <div style={{ color: '#94A3B8' }}>{ch.payments.length} платёж(ей)</div>
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          {!isFullyPaid && canManageBilling && (
                            <button
                              onClick={() => handleOpenPaymentModal(ch)}
                              data-testid={`record-payment-btn-${ch.id}`}
                              style={{
                                padding: '6px 12px',
                                background: '#16A34A',
                                color: '#FFFFFF',
                                border: 'none',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              + Зафиксировать оплату
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: RENEW SUBSCRIPTION */}
      {selectedSub && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '20px',
          }}
        >
          <div
            data-testid="renew-subscription-modal"
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', color: '#0F172A' }}>
              Продлить подписку: {selectedSub.tenant_name}
            </h3>
            <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 16px 0' }}>
              Тариф: <b>{selectedSub.plan_name}</b> · Текущее окончание:{' '}
              <b>{new Date(selectedSub.period_end).toLocaleDateString('ru-RU')}</b>
            </p>

            <form onSubmit={handleSubmitRenew} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Срок продления:
                </label>
                <select
                  value={renewDays}
                  onChange={e => setRenewDays(Number(e.target.value))}
                  data-testid="renew-days-select"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1' }}
                >
                  <option value={30}>30 дней (1 месяц)</option>
                  <option value={60}>60 дней (2 месяца)</option>
                  <option value={90}>90 дней (3 месяца / квартал)</option>
                  <option value={365}>365 дней (1 год)</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="chk-record-pmt"
                  checked={renewRecordPayment}
                  onChange={e => setRenewRecordPayment(e.target.checked)}
                  data-testid="renew-record-payment-checkbox"
                />
                <label htmlFor="chk-record-pmt" style={{ fontSize: '13px', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
                  Сразу зафиксировать подтверждённый платёж
                </label>
              </div>

              {renewRecordPayment && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: '#F8FAFC', padding: '14px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                      Сумма платежа (₸):
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={renewAmount}
                      onChange={e => setRenewAmount(Number(e.target.value))}
                      data-testid="renew-amount-input"
                      style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                      Способ оплаты:
                    </label>
                    <select
                      value={renewPaymentMethod}
                      onChange={e => setRenewPaymentMethod(e.target.value)}
                      data-testid="renew-payment-method-select"
                      style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #CBD5E1' }}
                    >
                      <option value="bank_transfer">Банковский перевод (по счёту)</option>
                      <option value="kaspi_pay">Kaspi Pay</option>
                      <option value="card">Корпоративная карта</option>
                      <option value="cash">Внесение в кассу</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                      Платёжное поручение / Номер квитанции:
                    </label>
                    <input
                      type="text"
                      value={renewEvidence}
                      onChange={e => setRenewEvidence(e.target.value)}
                      placeholder="Например: Kaspi Pay Чек №948201 или п/п 1045"
                      data-testid="renew-evidence-input"
                      style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setSelectedSub(null)}
                  style={{ padding: '8px 14px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRenew}
                  data-testid="confirm-renew-submit-btn"
                  style={{ padding: '8px 18px', background: '#2563EB', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  {isSubmittingRenew ? 'Продление...' : 'Продлить подписку'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RECORD PAYMENT FOR CHARGE */}
      {selectedCharge && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '20px',
          }}
        >
          <div
            data-testid="record-payment-modal"
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', color: '#0F172A' }}>
              Зафиксировать оплату счёта
            </h3>
            <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 16px 0' }}>
              Компания: <b>{selectedCharge.tenant_name}</b> · Сумма счёта:{' '}
              <b>{(selectedCharge.amount_minor / 100).toLocaleString('ru-RU')} ₸</b>
            </p>

            <form onSubmit={handleSubmitPayment} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div data-testid="payment-idempotency-key" style={{ fontSize: '11px', color: '#64748B', fontFamily: 'monospace' }}>
                Ключ операции: {paymentIdempotencyKey}
              </div>

              {paymentError && (
                <div data-testid="payment-error-banner" style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', padding: '10px 14px', borderRadius: '6px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div>{paymentError}</div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      data-testid="retry-payment-same-key-btn"
                      onClick={handleSubmitPayment}
                      disabled={isSubmittingPayment}
                      style={{ padding: '6px 12px', background: '#DC2626', color: '#FFFFFF', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Повторить с тем же ключом
                    </button>
                    <button
                      type="button"
                      data-testid="refresh-ledger-btn"
                      onClick={() => loadCharges()}
                      style={{ padding: '6px 12px', background: '#FFFFFF', color: '#374151', border: '1px solid #D1D5DB', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}
                    >
                      Обновить журнал начислений
                    </button>
                  </div>
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Сумма вносимого платежа (₸):
                </label>
                <input
                  type="number"
                  min={1}
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(Number(e.target.value))}
                  required
                  data-testid="payment-amount-input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Способ оплаты:
                </label>
                <select
                  value={paymentMethod}
                  onChange={e => setPaymentMethod(e.target.value)}
                  data-testid="payment-method-select"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1' }}
                >
                  <option value="bank_transfer">Банковский перевод (по реквизитам)</option>
                  <option value="kaspi_pay">Kaspi Pay</option>
                  <option value="card">Эквайринг карты</option>
                  <option value="cash">Наличные в кассу</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Номер платёжного поручения / подтверждающего документа:
                </label>
                <input
                  type="text"
                  value={paymentEvidence}
                  onChange={e => setPaymentEvidence(e.target.value)}
                  placeholder="Например: Kaspi Pay Чек №948201 или п/п 1045"
                  required
                  data-testid="payment-evidence-input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Примечание / Комментарий:
                </label>
                <input
                  type="text"
                  value={paymentNote}
                  onChange={e => setPaymentNote(e.target.value)}
                  placeholder="Оплата за продление периода подписки"
                  data-testid="payment-note-input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setSelectedCharge(null)}
                  style={{ padding: '8px 14px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPayment}
                  data-testid="confirm-record-payment-btn"
                  style={{ padding: '8px 18px', background: '#16A34A', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  {isSubmittingPayment ? 'Фиксация...' : 'Зафиксировать платёж'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
