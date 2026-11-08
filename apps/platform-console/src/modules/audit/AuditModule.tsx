import React, { useState, useEffect } from 'react';
import { PlatformApiClient, PlatformAuditEventItem } from '@crm/api-client';
import { PlatformRole } from '../../types';

interface AuditModuleProps {
  api: PlatformApiClient;
  token: string;
  userRole: PlatformRole;
  showToast: (msg: string) => void;
}

export const AuditModule: React.FC<AuditModuleProps> = ({
  api,
  token,
  userRole,
  showToast,
}) => {
  const [events, setEvents] = useState<PlatformAuditEventItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<PlatformAuditEventItem | null>(null);

  const loadAuditLogs = async () => {
    setIsLoading(true);
    try {
      const res = await api.getAuditLogs(
        {
          action: actionFilter || undefined,
          actor_email: actorFilter || undefined,
          limit: 100,
        },
        token
      );
      setEvents(res);
    } catch (err: any) {
      showToast(err.message || 'Ошибка загрузки журнала аудита');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAuditLogs();
  }, [token, actionFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* FILTER BAR */}
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
        <div style={{ display: 'flex', gap: '10px', flex: 1, flexWrap: 'wrap' }}>
          <input
            type="text"
            value={actorFilter}
            onChange={e => setActorFilter(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadAuditLogs()}
            placeholder="Фильтр по email оператора..."
            data-testid="audit-actor-filter"
            style={{ minWidth: '220px', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px' }}
          />
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            data-testid="audit-action-filter"
            style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px' }}
          >
            <option value="">Все действия аудита</option>
            <option value="tenant.created">tenant.created</option>
            <option value="tenant.suspended">tenant.suspended</option>
            <option value="tenant.reactivated">tenant.reactivated</option>
            <option value="tenant.plan_changed">tenant.plan_changed</option>
            <option value="tenant.entitlement_overridden">tenant.entitlement_overridden</option>
            <option value="tenant.invite_resent">tenant.invite_resent</option>
            <option value="subscription.renewed">subscription.renewed</option>
            <option value="payment.recorded">payment.recorded</option>
            <option value="plan.created">plan.created</option>
            <option value="plan.version_created">plan.version_created</option>
            <option value="support.access_requested">support.access_requested</option>
            <option value="support.session_started">support.session_started</option>
            <option value="support.session_revoked">support.session_revoked</option>
            <option value="platform_staff.created">platform_staff.created</option>
            <option value="platform_setting.updated">platform_setting.updated</option>
          </select>
          <button
            onClick={loadAuditLogs}
            style={{ padding: '8px 14px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
          >
            Применить
          </button>
        </div>

        <div style={{ fontSize: '12px', color: '#64748B' }}>
          🔒 Неизменяемый журнал (Append-only) · Записей: <b>{events.length}</b>
        </div>
      </div>

      {/* AUDIT EVENTS TABLE */}
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
            data-testid="audit-table"
            style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', color: '#64748B' }}>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Время (UTC/Local)</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Оператор платформы</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Действие (Action)</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Тип объекта</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Обоснование</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Детали</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} style={{ padding: '30px', textAlign: 'center', color: '#64748B' }}>
                    Загрузка журнала аудита...
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '30px', textAlign: 'center', color: '#64748B' }}>
                    События аудита не найдены.
                  </td>
                </tr>
              ) : (
                events.map(ev => (
                  <tr
                    key={ev.id}
                    data-testid={`audit-row-${ev.action}`}
                    style={{ borderBottom: '1px solid #F1F5F9' }}
                  >
                    <td style={{ padding: '12px 16px', color: '#64748B', fontSize: '12px', whiteSpace: 'nowrap' }}>
                      {new Date(ev.occurred_at).toLocaleString('ru-RU')}
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: '#0F172A' }}>
                      {ev.actor_email || 'система'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <code
                        style={{
                          background: '#EFF6FF',
                          color: '#1D4ED8',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '12px',
                        }}
                      >
                        {ev.action}
                      </code>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#475569' }}>
                      {ev.object_type}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#334155', maxWidth: '240px' }}>
                      {ev.reason || '—'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button
                        onClick={() => setSelectedEvent(ev)}
                        data-testid={`view-audit-diff-${ev.id}`}
                        style={{
                          padding: '5px 10px',
                          background: '#F1F5F9',
                          color: '#2563EB',
                          border: '1px solid #CBD5E1',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Diff (До/После)
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: DIFF VIEW */}
      {selectedEvent && (
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
            data-testid="audit-diff-modal"
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '600px',
              width: '100%',
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', color: '#0F172A' }}>Детали события аудита</h3>
                <code style={{ fontSize: '13px', color: '#2563EB' }}>{selectedEvent.action}</code>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                style={{ background: 'transparent', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94A3B8' }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              <div>Оператор: <b>{selectedEvent.actor_email}</b></div>
              <div>Дата: <b>{new Date(selectedEvent.occurred_at).toLocaleString('ru-RU')}</b></div>
              {selectedEvent.target_tenant_id && <div>ID компании: <code>{selectedEvent.target_tenant_id}</code></div>}
              {selectedEvent.reason && <div>Обоснование: <i>«{selectedEvent.reason}»</i></div>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <b style={{ fontSize: '12px', color: '#991B1B', display: 'block', marginBottom: '4px' }}>
                  Состояние ДО:
                </b>
                <pre
                  style={{
                    background: '#FEF2F2',
                    border: '1px solid #FCA5A5',
                    borderRadius: '6px',
                    padding: '10px',
                    fontSize: '12px',
                    overflowX: 'auto',
                    margin: 0,
                  }}
                >
                  {selectedEvent.before ? JSON.stringify(selectedEvent.before, null, 2) : 'null (создание)'}
                </pre>
              </div>

              <div>
                <b style={{ fontSize: '12px', color: '#166534', display: 'block', marginBottom: '4px' }}>
                  Состояние ПОСЛЕ:
                </b>
                <pre
                  style={{
                    background: '#F0FDF4',
                    border: '1px solid #86EFAC',
                    borderRadius: '6px',
                    padding: '10px',
                    fontSize: '12px',
                    overflowX: 'auto',
                    margin: 0,
                  }}
                >
                  {selectedEvent.after ? JSON.stringify(selectedEvent.after, null, 2) : 'null'}
                </pre>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                style={{ padding: '8px 16px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
