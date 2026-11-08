import React, { useState, useEffect } from 'react';
import { PlatformApiClient, PlatformFeatureItem } from '@crm/api-client';
import { PlatformRole } from '../../types';

interface ModulesCatalogModuleProps {
  api: PlatformApiClient;
  token: string;
  userRole: PlatformRole;
  showToast: (msg: string) => void;
}

export const ModulesCatalogModule: React.FC<ModulesCatalogModuleProps> = ({
  api,
  token,
  userRole,
  showToast,
}) => {
  const [items, setItems] = useState<PlatformFeatureItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadModules = async () => {
    setIsLoading(true);
    try {
      const res = await api.getModulesCatalog(token);
      setItems(res);
    } catch (err: any) {
      showToast(err.message || 'Ошибка загрузки каталога модулей');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadModules();
  }, [token]);

  const getStageBadge = (stage: string) => {
    switch (stage) {
      case 'available':
        return { label: 'Доступен (GA)', bg: '#DCFCE7', color: '#166534', border: '#86EFAC' };
      case 'beta':
        return { label: 'Бета-тест', bg: '#EFF6FF', color: '#1D4ED8', border: '#93C5FD' };
      case 'internal_test':
        return { label: 'Внутренний тест', bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' };
      case 'planned':
      default:
        return { label: 'Запланирован', bg: '#F1F5F9', color: '#475569', border: '#CBD5E1' };
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* EXPLANATORY 3-TIER CONCEPT CARDS */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '16px',
        }}
      >
        <div style={{ background: '#FFFFFF', padding: '16px 20px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={{ fontSize: '18px' }}>📚</span>
            <b style={{ fontSize: '14px', color: '#0F172A' }}>1. Каталог платформы</b>
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: '#64748B', lineHeight: 1.4 }}>
            Глобальный системный реестр функционала с указанием стадий зрелости (available, beta, planned) и настраиваемости.
          </p>
        </div>

        <div style={{ background: '#FFFFFF', padding: '16px 20px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={{ fontSize: '18px' }}>🏷️</span>
            <b style={{ fontSize: '14px', color: '#0F172A' }}>2. Лимиты тарифа (Entitlement)</b>
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: '#64748B', lineHeight: 1.4 }}>
            Юридическое право компании использовать функцию и допустимые квоты (число филиалов, число сотрудников, онлайн-букинг).
          </p>
        </div>

        <div style={{ background: '#FFFFFF', padding: '16px 20px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={{ fontSize: '18px' }}>🔌</span>
            <b style={{ fontSize: '14px', color: '#0F172A' }}>3. Фактическое подключение</b>
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: '#64748B', lineHeight: 1.4 }}>
            Операционный статус настройки фичи в компании (например: домен верифицирован, интеграция включена владельцем).
          </p>
        </div>
      </div>

      {/* FEATURE CATALOG TABLE */}
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
          <b style={{ fontSize: '15px', color: '#0F172A' }}>Системный каталог модулей и фичей</b>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table
            data-testid="modules-catalog-table"
            style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', color: '#64748B' }}>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Название модуля</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Системный ключ (Key)</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Стадия релиза</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Настраиваемый</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Назначение</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} style={{ padding: '30px', textAlign: 'center', color: '#64748B' }}>
                    Загрузка каталога...
                  </td>
                </tr>
              ) : (
                items.map(it => {
                  const badge = getStageBadge(it.release_stage);
                  return (
                    <tr
                      key={it.key}
                      data-testid={`feature-row-${it.key}`}
                      style={{ borderBottom: '1px solid #F1F5F9' }}
                    >
                      <td style={{ padding: '14px 16px', fontWeight: 600, color: '#0F172A' }}>
                        {it.name}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <code
                          style={{
                            background: '#F1F5F9',
                            color: '#0F172A',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '12px',
                          }}
                        >
                          {it.key}
                        </code>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: badge.bg,
                            color: badge.color,
                            border: `1px solid ${badge.border}`,
                          }}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', color: it.configurable ? '#16A34A' : '#64748B' }}>
                        {it.configurable ? '✅ Да' : '⚪ Нет'}
                      </td>
                      <td style={{ padding: '14px 16px', color: '#475569', fontSize: '12px' }}>
                        {it.description || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
