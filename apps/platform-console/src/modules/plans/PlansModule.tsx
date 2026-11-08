import React, { useState, useEffect } from 'react';
import { PlatformApiClient, PlatformPlanItem } from '@crm/api-client';
import { PlatformRole } from '../../types';

interface PlansModuleProps {
  api: PlatformApiClient;
  token: string;
  userRole: PlatformRole;
  showToast: (msg: string) => void;
}

export const PlansModule: React.FC<PlansModuleProps> = ({
  api,
  token,
  userRole,
  showToast,
}) => {
  const [plans, setPlans] = useState<PlatformPlanItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal: New Plan
  const [showNewPlanModal, setShowNewPlanModal] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPrice, setNewPrice] = useState(15000);
  const [newBranches, setNewBranches] = useState(2);
  const [newStaff, setNewStaff] = useState(8);

  // Modal: New Version
  const [selectedPlanForVersion, setSelectedPlanForVersion] = useState<PlatformPlanItem | null>(null);
  const [verPrice, setVerPrice] = useState(0);
  const [verBranches, setVerBranches] = useState(1);
  const [verStaff, setVerStaff] = useState(5);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canEditPlans = userRole === 'platform_owner';

  const loadPlans = async () => {
    setIsLoading(true);
    try {
      const res = await api.getPlans(token);
      setPlans(res);
    } catch (err: any) {
      showToast(err.message || 'Ошибка загрузки каталога тарифов');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPlans();
  }, [token]);

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    setIsSubmitting(true);
    try {
      await api.createPlan(
        {
          code: newCode.toLowerCase().trim(),
          name: newName.trim(),
          description: newDesc.trim() || undefined,
          price_minor: Math.round(newPrice * 100),
          max_branches: newBranches,
          max_active_staff: newStaff,
        },
        token
      );
      showToast(`Тариф ${newName} успешно создан`);
      setShowNewPlanModal(false);
      setNewCode('');
      setNewName('');
      setNewDesc('');
      await loadPlans();
    } catch (err: any) {
      showToast(err.message || 'Ошибка создания тарифа');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenNewVersionModal = (plan: PlatformPlanItem) => {
    setSelectedPlanForVersion(plan);
    const v = plan.active_version;
    setVerPrice(v ? v.price_minor / 100 : 10000);
    setVerBranches(v?.entitlements?.max_branches?.limit || 1);
    setVerStaff(v?.entitlements?.max_active_staff?.limit || 5);
  };

  const handleCreateVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanForVersion) return;
    setIsSubmitting(true);
    try {
      await api.createPlanVersion(
        selectedPlanForVersion.id,
        {
          price_minor: Math.round(verPrice * 100),
          max_branches: verBranches,
          max_active_staff: verStaff,
          online_booking: true,
          basic_reports: true,
        },
        token
      );
      showToast(`Новая версия тарифа ${selectedPlanForVersion.name} успешно создана`);
      setSelectedPlanForVersion(null);
      await loadPlans();
    } catch (err: any) {
      showToast(err.message || 'Ошибка создания версии тарифа');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* HEADER & NEW PLAN BUTTON */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '12px',
          padding: '20px 24px',
          border: '1px solid #E2E8F0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0F172A' }}>
            Каталог тарифных планов и версий
          </h2>
          <div style={{ fontSize: '13px', color: '#64748B', marginTop: '4px' }}>
            Версионность защищает действующие подписки компаний от внезапных изменений цен и лимитов
          </div>
        </div>

        {canEditPlans && (
          <button
            onClick={() => setShowNewPlanModal(true)}
            data-testid="create-new-plan-open-modal-btn"
            style={{
              padding: '9px 18px',
              background: '#2563EB',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>+</span> Новый тариф
          </button>
        )}
      </div>

      {/* PLANS CARDS GRID */}
      {isLoading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#64748B' }}>Загрузка каталога тарифов...</div>
      ) : (
        <div
          data-testid="plans-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '20px',
          }}
        >
          {plans.map(p => {
            const v = p.active_version;
            return (
              <div
                key={p.id}
                data-testid={`plan-card-${p.code}`}
                style={{
                  background: '#FFFFFF',
                  borderRadius: '12px',
                  border: '1px solid #E2E8F0',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          color: '#2563EB',
                          background: '#EFF6FF',
                          padding: '2px 8px',
                          borderRadius: '4px',
                        }}
                      >
                        {p.code}
                      </span>
                      <h3 style={{ margin: '6px 0 0 0', fontSize: '20px', fontWeight: 800, color: '#0F172A' }}>
                        {p.name}
                      </h3>
                    </div>
                    {v && (
                      <span
                        style={{
                          fontSize: '11px',
                          background: '#F1F5F9',
                          color: '#475569',
                          padding: '3px 8px',
                          borderRadius: '12px',
                          fontWeight: 600,
                        }}
                      >
                        v{v.version} (активна)
                      </span>
                    )}
                  </div>

                  <p style={{ fontSize: '13px', color: '#64748B', lineHeight: 1.4, margin: '0 0 16px 0' }}>
                    {p.description || 'Базовый коммерческий тариф платформы'}
                  </p>

                  <div style={{ marginBottom: '20px' }}>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: '#0F172A' }}>
                      {v ? (v.price_minor / 100).toLocaleString('ru-RU') : '0'} ₸
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#64748B' }}> / месяц</span>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748B' }}>Лимит филиалов:</span>
                      <b>{v?.entitlements?.max_branches?.limit ?? 1}</b>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748B' }}>Лимит мастеров:</span>
                      <b>{v?.entitlements?.max_active_staff?.limit ?? 5}</b>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748B' }}>Онлайн-запись клиентов:</span>
                      <span style={{ color: '#16A34A', fontWeight: 600 }}>Включена</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748B' }}>Базовые отчёты CRM:</span>
                      <span style={{ color: '#16A34A', fontWeight: 600 }}>Включены</span>
                    </div>
                  </div>
                </div>

                {canEditPlans && (
                  <div style={{ marginTop: '24px', borderTop: '1px solid #E2E8F0', paddingTop: '16px' }}>
                    <button
                      onClick={() => handleOpenNewVersionModal(p)}
                      data-testid={`create-new-version-btn-${p.code}`}
                      style={{
                        width: '100%',
                        padding: '9px',
                        background: '#F8FAFC',
                        color: '#1E293B',
                        border: '1px solid #CBD5E1',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Создать новую версию тарифа →
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL: CREATE NEW PLAN */}
      {showNewPlanModal && (
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
            data-testid="create-plan-modal"
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', color: '#0F172A' }}>Создать новый тарифный план</h3>
            <form onSubmit={handleCreatePlan} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Код тарифа (slug):
                </label>
                <input
                  type="text"
                  value={newCode}
                  onChange={e => setNewCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                  placeholder="enterprise"
                  required
                  data-testid="plan-code-input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Название тарифа:
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Enterprise"
                  required
                  data-testid="plan-name-input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Описание тарифа:
                </label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  placeholder="Для крупных сетей и франшиз"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    Цена (₸ / мес):
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={newPrice}
                    onChange={e => setNewPrice(Number(e.target.value))}
                    required
                    data-testid="plan-price-input"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    Макс. филиалов:
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={newBranches}
                    onChange={e => setNewBranches(Number(e.target.value))}
                    required
                    data-testid="plan-branches-input"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Макс. активных мастеров:
                </label>
                <input
                  type="number"
                  min={1}
                  value={newStaff}
                  onChange={e => setNewStaff(Number(e.target.value))}
                  required
                  data-testid="plan-staff-input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowNewPlanModal(false)}
                  style={{ padding: '8px 14px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  data-testid="confirm-create-plan-btn"
                  style={{ padding: '8px 18px', background: '#2563EB', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  {isSubmitting ? 'Создание...' : 'Создать тариф'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE NEW PLAN VERSION */}
      {selectedPlanForVersion && (
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
            data-testid="create-version-modal"
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', color: '#0F172A' }}>
              Новая версия тарифа: {selectedPlanForVersion.name}
            </h3>
            <div style={{ fontSize: '12px', color: '#B45309', background: '#FFFBEB', padding: '10px', borderRadius: '6px', marginBottom: '16px' }}>
              ⚠️ Существующие подписчики останутся на своей текущей версии. Новая версия будет действовать для новых компаний и продлений после миграции.
            </div>

            <form onSubmit={handleCreateVersion} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Новая цена (₸ / месяц):
                </label>
                <input
                  type="number"
                  min={0}
                  value={verPrice}
                  onChange={e => setVerPrice(Number(e.target.value))}
                  required
                  data-testid="version-price-input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    Лимит филиалов:
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={verBranches}
                    onChange={e => setVerBranches(Number(e.target.value))}
                    required
                    data-testid="version-branches-input"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    Лимит мастеров:
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={verStaff}
                    onChange={e => setVerStaff(Number(e.target.value))}
                    required
                    data-testid="version-staff-input"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setSelectedPlanForVersion(null)}
                  style={{ padding: '8px 14px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  data-testid="confirm-create-version-btn"
                  style={{ padding: '8px 18px', background: '#2563EB', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  {isSubmitting ? 'Публикация...' : 'Опубликовать версию'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
