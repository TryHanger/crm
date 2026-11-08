import React, { useState, useEffect } from 'react';
import {
  PlatformApiClient,
  PlatformSupportTicketItem,
  PlatformSupportTicketDetail,
  PlatformDiagnosisResponse,
  PlatformAccessRequestItem,
  PlatformTenantListItem,
} from '@crm/api-client';
import { PlatformRole } from '../../types';

interface SupportModuleProps {
  api: PlatformApiClient;
  token: string;
  userRole: PlatformRole;
  initialTenantId?: string | null;
  onRefreshActiveSession: () => void;
  showToast: (msg: string) => void;
}

export const SupportModule: React.FC<SupportModuleProps> = ({
  api,
  token,
  userRole,
  initialTenantId,
  onRefreshActiveSession,
  showToast,
}) => {
  const [activeTab, setActiveTab] = useState<'tickets' | 'diagnosis' | 'access'>('tickets');

  // Tickets state
  const [tickets, setTickets] = useState<PlatformSupportTicketItem[]>([]);
  const [isLoadingTickets, setIsLoadingTickets] = useState(true);
  const [ticketStatusFilter, setTicketStatusFilter] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<PlatformSupportTicketDetail | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  // Diagnosis state
  const [allTenants, setAllTenants] = useState<PlatformTenantListItem[]>([]);
  const [diagnoseTenantId, setDiagnoseTenantId] = useState<string>(initialTenantId || '');
  const [diagnosisData, setDiagnosisData] = useState<PlatformDiagnosisResponse | null>(null);
  const [isLoadingDiagnosis, setIsLoadingDiagnosis] = useState(false);

  // Access Requests state
  const [accessRequests, setAccessRequests] = useState<PlatformAccessRequestItem[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestTenantId, setRequestTenantId] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);

  // New Ticket Modal state
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
  const [ticketTenantId, setTicketTenantId] = useState('');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketPriority, setTicketPriority] = useState('normal');
  const [ticketInitialMsg, setTicketInitialMsg] = useState('');

  const canManageSupport = ['platform_owner', 'support'].includes(userRole);

  const loadTickets = async () => {
    setIsLoadingTickets(true);
    try {
      const res = await api.getSupportTickets({ status_filter: ticketStatusFilter || undefined }, token);
      setTickets(res);
    } catch (err: any) {
      showToast(err.message || 'Ошибка загрузки тикетов');
    } finally {
      setIsLoadingTickets(false);
    }
  };

  const loadTenantsForSelect = async () => {
    try {
      const res = await api.getTenants({}, token);
      setAllTenants(res);
      if (!diagnoseTenantId && res.length > 0) {
        setDiagnoseTenantId(res[0].id);
      }
      if (!requestTenantId && res.length > 0) {
        setRequestTenantId(res[0].id);
      }
      if (!ticketTenantId && res.length > 0) {
        setTicketTenantId(res[0].id);
      }
    } catch (e) {
      // ignore
    }
  };

  const loadDiagnosis = async (tenantId: string) => {
    if (!tenantId) return;
    setIsLoadingDiagnosis(true);
    try {
      const res = await api.getTenantDiagnosis(tenantId, token);
      setDiagnosisData(res);
    } catch (err: any) {
      showToast(err.message || 'Ошибка загрузки диагностики');
    } finally {
      setIsLoadingDiagnosis(false);
    }
  };

  const loadAccessRequests = async () => {
    setIsLoadingRequests(true);
    try {
      const res = await api.getAccessRequests(token);
      setAccessRequests(res);
    } catch (err: any) {
      showToast(err.message || 'Ошибка загрузки запросов доступа');
    } finally {
      setIsLoadingRequests(false);
    }
  };

  useEffect(() => {
    loadTenantsForSelect();
  }, [token]);

  useEffect(() => {
    if (activeTab === 'tickets') {
      loadTickets();
    } else if (activeTab === 'diagnosis') {
      if (diagnoseTenantId) loadDiagnosis(diagnoseTenantId);
    } else if (activeTab === 'access') {
      loadAccessRequests();
    }
  }, [token, activeTab, ticketStatusFilter, diagnoseTenantId]);

  const handleOpenTicket = async (ticketId: string) => {
    try {
      const d = await api.getSupportTicketDetails(ticketId, token);
      setSelectedTicket(d);
    } catch (err: any) {
      showToast(err.message || 'Ошибка открытия обращения');
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !newMessage.trim()) return;
    setIsSendingMessage(true);
    try {
      await api.addSupportMessage(
        selectedTicket.id,
        {
          message: newMessage.trim(),
          is_internal: isInternalNote,
        },
        token
      );
      setNewMessage('');
      const updated = await api.getSupportTicketDetails(selectedTicket.id, token);
      setSelectedTicket(updated);
      showToast('Сообщение отправлено');
    } catch (err: any) {
      showToast(err.message || 'Ошибка отправки сообщения');
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketTenantId || !ticketSubject.trim()) return;
    try {
      await api.createSupportTicket(
        {
          tenant_id: ticketTenantId,
          subject: ticketSubject.trim(),
          priority: ticketPriority,
          initial_message: ticketInitialMsg.trim(),
        },
        token
      );
      showToast('Обращение успешно создано');
      setShowNewTicketModal(false);
      setTicketSubject('');
      setTicketInitialMsg('');
      await loadTickets();
    } catch (err: any) {
      showToast(err.message || 'Ошибка создания тикета');
    }
  };

  const handleCreateAccessRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestTenantId || !requestReason.trim()) return;
    setIsSubmittingRequest(true);
    try {
      await api.createAccessRequest(
        {
          tenant_id: requestTenantId,
          reason: requestReason.trim(),
          requested_scope: 'read_only_diagnostic',
        },
        token
      );
      showToast('Запрос временного доступа отправлен владельцу компании');
      setShowRequestModal(false);
      setRequestReason('');
      await loadAccessRequests();
    } catch (err: any) {
      showToast(err.message || 'Ошибка отправки запроса');
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const handleApproveAccess = async (requestId: string) => {
    try {
      await api.approveAccessRequest(requestId, token);
      showToast('Доступ на 30 минут активирован!');
      onRefreshActiveSession();
      await loadAccessRequests();
    } catch (err: any) {
      showToast(err.message || 'Ошибка одобрения доступа');
    }
  };

  const handleRevokeAccess = async (requestId: string) => {
    try {
      await api.revokeAccessRequest(requestId, token);
      showToast('Доступ немедленно отозван');
      onRefreshActiveSession();
      await loadAccessRequests();
    } catch (err: any) {
      showToast(err.message || 'Ошибка отзыва доступа');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* TABS BAR */}
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
            onClick={() => setActiveTab('tickets')}
            data-testid="tab-support-tickets"
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: activeTab === 'tickets' ? '#2563EB' : '#F1F5F9',
              color: activeTab === 'tickets' ? '#FFFFFF' : '#475569',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            🎧 Обращения (Тикеты)
          </button>
          <button
            onClick={() => setActiveTab('diagnosis')}
            data-testid="tab-support-diagnosis"
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: activeTab === 'diagnosis' ? '#2563EB' : '#F1F5F9',
              color: activeTab === 'diagnosis' ? '#FFFFFF' : '#475569',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            🩺 Диагностика компании
          </button>
          <button
            onClick={() => setActiveTab('access')}
            data-testid="tab-support-access"
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: activeTab === 'access' ? '#2563EB' : '#F1F5F9',
              color: activeTab === 'access' ? '#FFFFFF' : '#475569',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            🛡️ Временный доступ (30 мин)
          </button>
        </div>

        {activeTab === 'tickets' && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <select
              value={ticketStatusFilter}
              onChange={e => setTicketStatusFilter(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px' }}
            >
              <option value="">Все статусы</option>
              <option value="open">Открытые</option>
              <option value="in_progress">В работе</option>
              <option value="resolved">Решённые</option>
            </select>
            {canManageSupport && (
              <button
                onClick={() => setShowNewTicketModal(true)}
                data-testid="create-ticket-open-modal-btn"
                style={{
                  padding: '7px 14px',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + Новое обращение
              </button>
            )}
          </div>
        )}

        {activeTab === 'access' && canManageSupport && (
          <button
            onClick={() => setShowRequestModal(true)}
            data-testid="request-access-open-modal-btn"
            style={{
              padding: '8px 16px',
              background: '#D97706',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            🛡️ Запросить доступ к компании
          </button>
        )}
      </div>

      {/* TAB 1: TICKETS LIST */}
      {activeTab === 'tickets' && (
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
              data-testid="support-tickets-table"
              style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', color: '#64748B' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Компания</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Тема обращения</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Приоритет</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Статус</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Сообщений</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Дата создания</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Действие</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingTickets ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '30px', textAlign: 'center', color: '#64748B' }}>
                      Загрузка тикетов...
                    </td>
                  </tr>
                ) : tickets.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '30px', textAlign: 'center', color: '#64748B' }}>
                      Обращения не найдены.
                    </td>
                  </tr>
                ) : (
                  tickets.map(t => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '14px 16px' }}>
                        <b style={{ color: '#0F172A' }}>{t.tenant_name}</b>
                        <div style={{ fontSize: '11px', color: '#94A3B8' }}>{t.tenant_slug}</div>
                      </td>
                      <td style={{ padding: '14px 16px', fontWeight: 600, color: '#0F172A' }}>{t.subject}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: t.priority === 'high' ? '#FEE2E2' : '#F1F5F9',
                            color: t.priority === 'high' ? '#DC2626' : '#475569',
                          }}
                        >
                          {t.priority === 'high' ? 'Высокий' : 'Обычный'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: t.status === 'open' ? '#FEF3C7' : '#DCFCE7',
                            color: t.status === 'open' ? '#92400E' : '#166534',
                          }}
                        >
                          {t.status === 'open' ? 'Открыт' : t.status}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', color: '#475569' }}>💬 {t.messages_count}</td>
                      <td style={{ padding: '14px 16px', color: '#64748B', fontSize: '12px' }}>
                        {new Date(t.created_at).toLocaleString('ru-RU')}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <button
                          onClick={() => handleOpenTicket(t.id)}
                          data-testid={`open-ticket-btn-${t.id}`}
                          style={{
                            padding: '6px 12px',
                            background: '#F1F5F9',
                            color: '#2563EB',
                            border: '1px solid #CBD5E1',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Открыть диалог →
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: DIAGNOSIS CARD */}
      {activeTab === 'diagnosis' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              padding: '16px 20px',
              border: '1px solid #E2E8F0',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              Выберите компанию для диагностики:
            </label>
            <select
              value={diagnoseTenantId}
              onChange={e => setDiagnoseTenantId(e.target.value)}
              data-testid="select-diagnose-tenant"
              style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px' }}
            >
              {allTenants.map(t => (
                <option key={t.id} value={t.id}>
                  {t.display_name} ({t.slug})
                </option>
              ))}
            </select>
          </div>

          {isLoadingDiagnosis ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748B' }}>Анализ состояния компании...</div>
          ) : diagnosisData ? (
            <div
              data-testid="diagnosis-report-card"
              style={{
                background: '#FFFFFF',
                borderRadius: '12px',
                padding: '24px',
                border: '1px solid #E2E8F0',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
              }}
            >
              <div>
                <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', color: '#0F172A' }}>
                  Диагностика: {diagnosisData.tenant.display_name}
                </h3>
                <div style={{ fontSize: '12px', color: '#64748B' }}>
                  Статус: <b>{diagnosisData.tenant.lifecycle_status}</b> · Часовой пояс:{' '}
                  <b>{diagnosisData.tenant.timezone}</b>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                <div style={{ padding: '16px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '12px', color: '#64748B' }}>База данных и RLS</div>
                  <b style={{ fontSize: '16px', color: '#16A34A', marginTop: '4px', display: 'block' }}>
                    {diagnosisData.infrastructure.db_status.toUpperCase()}
                  </b>
                  <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                    Изоляция: {diagnosisData.infrastructure.rls_enforcement}
                  </div>
                </div>

                <div style={{ padding: '16px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '12px', color: '#64748B' }}>Подписка и тариф</div>
                  <b style={{ fontSize: '16px', color: '#0F172A', marginTop: '4px', display: 'block' }}>
                    {diagnosisData.subscription?.plan_name || '—'}
                  </b>
                  <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>
                    Статус: {diagnosisData.subscription?.status || '—'}
                  </div>
                </div>

                <div style={{ padding: '16px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '12px', color: '#64748B' }}>Операционные метрики</div>
                  <div style={{ fontSize: '13px', marginTop: '6px', color: '#0F172A' }}>
                    Филиалов: <b>{diagnosisData.metrics.branches}</b> · Мастеров: <b>{diagnosisData.metrics.staff}</b>
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>
                    Услуг: {diagnosisData.metrics.services} · Всего записей: {diagnosisData.metrics.bookings_total}
                  </div>
                </div>
              </div>

              <div>
                <b style={{ fontSize: '14px', color: '#0F172A', display: 'block', marginBottom: '8px' }}>
                  Маршрутизация и SSL домены:
                </b>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {diagnosisData.domains.map((d, i) => (
                    <div key={i} style={{ padding: '10px 14px', background: '#F8FAFC', borderRadius: '6px', fontSize: '13px', display: 'flex', justifyContent: 'space-between' }}>
                      <span>🌐 {d.hostname}</span>
                      <span style={{ color: '#16A34A', fontWeight: 600 }}>{d.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* TAB 3: ACCESS REQUESTS */}
      {activeTab === 'access' && (
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: '12px',
            border: '1px solid #E2E8F0',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #E2E8F0', background: '#FAFAFA' }}>
            <b style={{ fontSize: '15px', color: '#0F172A' }}>Журнал запросов временного доступа</b>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table
              data-testid="access-requests-table"
              style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', color: '#64748B' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Компания</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Оператор</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Причина доступа</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Статус</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Срок действия</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingRequests ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '30px', textAlign: 'center', color: '#64748B' }}>
                      Загрузка запросов...
                    </td>
                  </tr>
                ) : accessRequests.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '30px', textAlign: 'center', color: '#64748B' }}>
                      Нет активных запросов доступа.
                    </td>
                  </tr>
                ) : (
                  accessRequests.map(req => (
                    <tr key={req.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '14px 16px', fontWeight: 600 }}>{req.tenant_name}</td>
                      <td style={{ padding: '14px 16px', color: '#475569' }}>{req.requester_name}</td>
                      <td style={{ padding: '14px 16px', maxWidth: '280px' }}>{req.reason}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background:
                              req.status === 'approved'
                                ? '#DCFCE7'
                                : req.status === 'pending'
                                ? '#FEF3C7'
                                : '#F1F5F9',
                            color:
                              req.status === 'approved'
                                ? '#166534'
                                : req.status === 'pending'
                                ? '#92400E'
                                : '#475569',
                          }}
                        >
                          {req.status === 'approved'
                            ? 'Одобрен'
                            : req.status === 'pending'
                            ? 'Ожидает одобрения'
                            : req.status === 'revoked'
                            ? 'Отозван'
                            : req.status}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: '12px', color: '#64748B' }}>
                        до {new Date(req.expires_at).toLocaleString('ru-RU')}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        {req.status === 'pending' && canManageSupport && (
                          <button
                            onClick={() => handleApproveAccess(req.id)}
                            data-testid={`approve-access-btn-${req.id}`}
                            style={{
                              padding: '5px 10px',
                              background: '#16A34A',
                              color: '#FFFFFF',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Одобрить (30 мин)
                          </button>
                        )}
                        {req.status === 'approved' && canManageSupport && (
                          <button
                            onClick={() => handleRevokeAccess(req.id)}
                            data-testid={`revoke-access-btn-${req.id}`}
                            style={{
                              padding: '5px 10px',
                              background: '#DC2626',
                              color: '#FFFFFF',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Отозвать
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

      {/* MODAL: TICKET CHAT */}
      {selectedTicket && (
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
            data-testid="ticket-chat-modal"
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              maxWidth: '600px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '80vh',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <b style={{ fontSize: '16px', color: '#0F172A' }}>{selectedTicket.subject}</b>
                <div style={{ fontSize: '12px', color: '#64748B' }}>
                  Компания: {selectedTicket.tenant_name} · Статус: {selectedTicket.status}
                </div>
              </div>
              <button
                onClick={() => setSelectedTicket(null)}
                style={{ background: 'transparent', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94A3B8' }}
              >
                ✕
              </button>
            </div>

            {/* Messages body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {selectedTicket.messages.map(m => {
                const isSupport = m.sender_role === 'platform_support';
                return (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: isSupport ? 'flex-end' : 'flex-start',
                      maxWidth: '80%',
                      background: m.is_internal ? '#FEF3C7' : isSupport ? '#EFF6FF' : '#F1F5F9',
                      border: `1px solid ${m.is_internal ? '#FDE68A' : isSupport ? '#BFDBFE' : '#E2E8F0'}`,
                      borderRadius: '10px',
                      padding: '10px 14px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11px', color: '#64748B', marginBottom: '4px' }}>
                      <b>{m.sender_name} {m.is_internal && '🔒 (внутренняя заметка)'}</b>
                      <span>{new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#0F172A', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                      {m.message}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Input footer */}
            <form onSubmit={handleSendMessage} style={{ padding: '14px 20px', borderTop: '1px solid #E2E8F0', background: '#F8FAFC' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <input
                  type="checkbox"
                  id="chk-internal"
                  checked={isInternalNote}
                  onChange={e => setIsInternalNote(e.target.checked)}
                />
                <label htmlFor="chk-internal" style={{ fontSize: '12px', color: '#475569', cursor: 'pointer' }}>
                  🔒 Внутренняя заметка поддержки (не видна клиенту)
                </label>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  type="text"
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  placeholder="Напишите ответ..."
                  required
                  data-testid="ticket-new-message-input"
                  style={{ flex: 1, padding: '9px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px', outline: 'none' }}
                />
                <button
                  type="submit"
                  disabled={isSendingMessage}
                  data-testid="ticket-send-message-btn"
                  style={{ padding: '9px 16px', background: '#2563EB', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
                >
                  Отправить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: REQUEST ACCESS */}
      {showRequestModal && (
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
            data-testid="request-access-modal"
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
              Запрос временного диагностического доступа
            </h3>
            <p style={{ fontSize: '13px', color: '#64748B', lineHeight: 1.4, margin: '0 0 16px 0' }}>
              Доступ выдаётся на <b>30 минут</b> исключительно в целях решения обращения и требует подтверждения владельца компании.
            </p>

            <form onSubmit={handleCreateAccessRequest} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Компания:
                </label>
                <select
                  value={requestTenantId}
                  onChange={e => setRequestTenantId(e.target.value)}
                  data-testid="access-tenant-select"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1' }}
                >
                  {allTenants.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.display_name} ({t.slug})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Обязательное обоснование (номер обращения / причина):
                </label>
                <textarea
                  value={requestReason}
                  onChange={e => setRequestReason(e.target.value)}
                  placeholder="Обращение #1042: диагностика сбоя отправки приглашений сотрудникам"
                  rows={3}
                  required
                  data-testid="access-reason-input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowRequestModal(false)}
                  style={{ padding: '8px 14px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRequest}
                  data-testid="confirm-request-access-btn"
                  style={{ padding: '8px 18px', background: '#D97706', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  {isSubmittingRequest ? 'Отправка...' : 'Отправить запрос'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE TICKET */}
      {showNewTicketModal && (
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
              Создать обращение в поддержку
            </h3>
            <form onSubmit={handleCreateTicket} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Компания:
                </label>
                <select
                  value={ticketTenantId}
                  onChange={e => setTicketTenantId(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1' }}
                >
                  {allTenants.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.display_name} ({t.slug})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Тема обращения:
                </label>
                <input
                  type="text"
                  value={ticketSubject}
                  onChange={e => setTicketSubject(e.target.value)}
                  placeholder="Не приходят уведомления о бронированиях"
                  required
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Приоритет:
                </label>
                <select
                  value={ticketPriority}
                  onChange={e => setTicketPriority(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1' }}
                >
                  <option value="normal">Обычный</option>
                  <option value="high">Высокий</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Первое сообщение:
                </label>
                <textarea
                  value={ticketInitialMsg}
                  onChange={e => setTicketInitialMsg(e.target.value)}
                  placeholder="Опишите суть проблемы клиента..."
                  rows={3}
                  required
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowNewTicketModal(false)}
                  style={{ padding: '8px 14px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  style={{ padding: '8px 18px', background: '#2563EB', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Создать обращение
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
