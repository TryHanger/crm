import React, { useState, useEffect } from 'react';
import { PlatformApiClient, PlatformOverviewResponse } from '@crm/api-client';
import { PlatformNavigationSection, PlatformRole } from '../../types';

interface OverviewModuleProps {
  api: PlatformApiClient;
  token: string;
  userRole: PlatformRole;
  onNavigate: (section: PlatformNavigationSection) => void;
  onSelectTenant: (tenantId: string) => void;
}

export const OverviewModule: React.FC<OverviewModuleProps> = ({
  api,
  token,
  userRole,
  onNavigate,
  onSelectTenant,
}) => {
  const [data, setData] = useState<PlatformOverviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getOverview(token);
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки обзора платформы');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token]);

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748B' }}>
        Загрузка операционных показателей платформы...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        style={{
          background: '#FEF2F2',
          border: '1px solid #FCA5A5',
          borderRadius: '8px',
          padding: '16px',
          color: '#991B1B',
          textAlign: 'center',
        }}
      >
        <p>{error || 'Не удалось получить данные обзора'}</p>
        <button
          onClick={loadData}
          style={{
            padding: '8px 16px',
            background: '#DC2626',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          Повторить попытку
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 4 KPI CARDS */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '16px',
        }}
      >
        <div
          data-testid="kpi-total-tenants"
          style={{
            background: '#FFFFFF',
            borderRadius: '12px',
            padding: '20px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
            Всего компаний
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#0F172A', marginTop: '6px' }}>
            {data.total_tenants}
          </div>
          <div style={{ fontSize: '12px', color: '#16A34A', marginTop: '4px' }}>
            База арендаторов SaaS
          </div>
        </div>

        <div
          data-testid="kpi-active-subscriptions"
          style={{
            background: '#FFFFFF',
            borderRadius: '12px',
            padding: '20px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
            Активные подписки
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#2563EB', marginTop: '6px' }}>
            {data.active_subscriptions}
          </div>
          <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px' }}>
            Trial, Active и Grace периоды
          </div>
        </div>

        <div
          data-testid="kpi-suspended-tenants"
          style={{
            background: data.suspended_tenants > 0 ? '#FFFBEB' : '#FFFFFF',
            borderRadius: '12px',
            padding: '20px',
            border: `1px solid ${data.suspended_tenants > 0 ? '#FDE68A' : '#E2E8F0'}`,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
            Приостановлены
          </div>
          <div
            style={{
              fontSize: '28px',
              fontWeight: 800,
              color: data.suspended_tenants > 0 ? '#D97706' : '#0F172A',
              marginTop: '6px',
            }}
          >
            {data.suspended_tenants}
          </div>
          <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px' }}>
            Заморожен публичный букинг
          </div>
        </div>

        <div
          data-testid="kpi-total-revenue"
          style={{
            background: '#FFFFFF',
            borderRadius: '12px',
            padding: '20px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
            Подтверждённая выручка
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#0F172A', marginTop: '6px' }}>
            {data.total_revenue_formatted}
          </div>
          <div
            data-testid="non-mrr-disclaimer"
            style={{ fontSize: '11px', color: '#94A3B8', marginTop: '4px', lineHeight: 1.3 }}
          >
            ⚠️ {data.non_mrr_disclaimer}
          </div>
        </div>
      </div>

      {/* ATTENTION & RECENT TENANTS SPLIT */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '20px',
          alignItems: 'start',
        }}
      >
        {/* ATTENTION BLOCK: Срочно сегодня + В ближайшие дни */}
        <div
          data-testid="attention-block"
          style={{
            background: '#FFFFFF',
            borderRadius: '12px',
            border: '1px solid #E2E8F0',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid #E2E8F0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#FAFAFA',
            }}
          >
            <b style={{ fontSize: '15px', color: '#0F172A' }}>⚡ Требуют внимания</b>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#DC2626',
                background: '#FEE2E2',
                borderRadius: '12px',
                padding: '2px 8px',
              }}
            >
              {data.attention_items.urgent_today.length} срочно
            </span>
          </div>

          <div style={{ padding: '16px' }}>
            {/* Urgent today */}
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#B91C1C', marginBottom: '8px' }}>
              🔴 Срочно сегодня ({data.attention_items.urgent_today.length})
            </div>
            {data.attention_items.urgent_today.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '16px', padding: '6px 0' }}>
                Критических проблем с подписками на сегодня нет.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                {data.attention_items.urgent_today.map((item, idx) => (
                  <div
                    key={idx}
                    data-testid="urgent-attention-item"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      background: '#FEF2F2',
                      border: '1px solid #FCA5A5',
                      borderRadius: '8px',
                      gap: '12px',
                    }}
                  >
                    <div>
                      <b style={{ fontSize: '13px', color: '#991B1B' }}>{item.tenant_name}</b>
                      <div style={{ fontSize: '12px', color: '#B91C1C' }}>{item.issue}</div>
                    </div>
                    <button
                      onClick={() => onSelectTenant(item.tenant_id)}
                      data-testid={`attention-action-${item.tenant_slug}`}
                      style={{
                        padding: '6px 12px',
                        background: '#DC2626',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      Карточка
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Upcoming days */}
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>
              🟡 В ближайшие 7 дней ({data.attention_items.upcoming_days.length})
            </div>
            {data.attention_items.upcoming_days.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#94A3B8', padding: '6px 0' }}>
                В ближайшие дни истекающих подписок нет.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {data.attention_items.upcoming_days.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      background: '#FFFBEB',
                      border: '1px solid #FDE68A',
                      borderRadius: '8px',
                      gap: '12px',
                    }}
                  >
                    <div>
                      <b style={{ fontSize: '13px', color: '#92400E' }}>{item.tenant_name}</b>
                      <div style={{ fontSize: '12px', color: '#B45309' }}>
                        Тариф {item.plan_name} · {item.issue}
                      </div>
                    </div>
                    <button
                      onClick={() => onSelectTenant(item.tenant_id)}
                      style={{
                        padding: '6px 12px',
                        background: '#FFFFFF',
                        color: '#92400E',
                        border: '1px solid #D97706',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      Открыть
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RECENT TENANTS & QUICK ACTIONS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Recent Tenants Table */}
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              border: '1px solid #E2E8F0',
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <div
              style={{
                padding: '14px 18px',
                borderBottom: '1px solid #E2E8F0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#FAFAFA',
              }}
            >
              <b style={{ fontSize: '15px', color: '#0F172A' }}>🏢 Последние компании</b>
              <button
                onClick={() => onNavigate('companies')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#2563EB',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Все компании →
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E2E8F0', color: '#64748B' }}>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Компания</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Ниша</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Тариф</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Статус</th>
                    <th style={{ padding: '10px 14px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_tenants.map(t => (
                    <tr
                      key={t.id}
                      style={{ borderBottom: '1px solid #F1F5F9' }}
                    >
                      <td style={{ padding: '12px 14px', fontWeight: 600, color: '#0F172A' }}>
                        {t.display_name}
                        <div style={{ fontSize: '11px', color: '#94A3B8' }}>{t.slug}.book.example.kz</div>
                      </td>
                      <td style={{ padding: '12px 14px', color: '#475569' }}>
                        {t.vertical === 'barbershop'
                          ? 'Барбершоп'
                          : t.vertical === 'beauty_salon'
                          ? 'Салон красоты'
                          : t.vertical === 'dentistry'
                          ? 'Стоматология'
                          : t.vertical}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span
                          style={{
                            background: '#F1F5F9',
                            color: '#334155',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 500,
                          }}
                        >
                          {t.plan_name}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: t.lifecycle_status === 'active' ? '#DCFCE7' : '#FEE2E2',
                            color: t.lifecycle_status === 'active' ? '#166534' : '#991B1B',
                          }}
                        >
                          {t.lifecycle_status === 'active' ? 'Активна' : 'Приостановлена'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                        <button
                          onClick={() => onSelectTenant(t.id)}
                          style={{
                            background: 'transparent',
                            border: '1px solid #CBD5E1',
                            borderRadius: '6px',
                            padding: '4px 8px',
                            color: '#334155',
                            fontSize: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          Открыть
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Quick Actions Card */}
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              padding: '16px 20px',
              border: '1px solid #E2E8F0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <b style={{ fontSize: '14px', color: '#0F172A' }}>Быстрые действия платформы</b>
              <div style={{ fontSize: '12px', color: '#64748B' }}>Переход к ключевым операциям</div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={() => onNavigate('companies')}
                data-testid="quick-action-new-tenant"
                style={{
                  padding: '8px 14px',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + Новая компания
              </button>
              <button
                onClick={() => onNavigate('subs')}
                style={{
                  padding: '8px 14px',
                  background: '#F1F5F9',
                  color: '#1E293B',
                  border: '1px solid #CBD5E1',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                💳 Счета и оплата
              </button>
              <button
                onClick={() => onNavigate('support')}
                style={{
                  padding: '8px 14px',
                  background: '#F1F5F9',
                  color: '#1E293B',
                  border: '1px solid #CBD5E1',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                🎧 Тикеты поддержки
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
