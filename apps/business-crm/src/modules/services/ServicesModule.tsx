import React, { useState, useEffect } from 'react';
import { BusinessCrmApiClient, ServiceDetailResponse, ServiceCategoryResponse } from '@crm/api-client';

interface ServicesModuleProps {
  api: BusinessCrmApiClient;
  token: string;
  tenantId: string;
  onShowToast: (msg: string) => void;
  userRole: string;
}

export const ServicesModule: React.FC<ServicesModuleProps> = ({
  api,
  token,
  tenantId,
  onShowToast,
  userRole,
}) => {
  const [categories, setCategories] = useState<ServiceCategoryResponse[]>([]);
  const [services, setServices] = useState<ServiceDetailResponse[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState<ServiceDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Form states for selected service
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formDuration, setFormDuration] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [formOnline, setFormOnline] = useState(true);
  const [formCatId, setFormCatId] = useState('');

  // Modals
  const [showCatModal, setShowCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [showCreateSvcModal, setShowCreateSvcModal] = useState(false);
  const [newSvcName, setNewSvcName] = useState('');
  const [newSvcPrice, setNewSvcPrice] = useState('7000');
  const [newSvcDuration, setNewSvcDuration] = useState('45');
  const [newSvcCatId, setNewSvcCatId] = useState('');

  // Load data
  const loadData = async () => {
    try {
      setIsLoading(true);
      const [cats, svcs] = await Promise.all([
        api.getServiceCategories(token, tenantId),
        api.getServices({}, token, tenantId),
      ]);
      setCategories(cats || []);
      setServices(svcs || []);
      if (svcs && svcs.length > 0 && !selectedService) {
        selectService(svcs[0]);
      }
    } catch (err: any) {
      console.error('Failed to load services data', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const selectService = (svc: ServiceDetailResponse) => {
    setSelectedService(svc);
    setFormName(svc.name);
    setFormDesc(svc.description || '');
    setFormPrice(String(svc.base_price_minor / 100));
    setFormDuration(String(svc.base_duration_minutes));
    setFormActive(svc.active);
    setFormOnline(svc.online_visible);
    setFormCatId(svc.category_id || '');
  };

  // Filtered services
  const filteredServices = activeCategoryId
    ? services.filter(s => s.category_id === activeCategoryId)
    : services;

  // Save updated service
  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedService) return;
    try {
      setIsSaving(true);
      await api.updateService(
        selectedService.id,
        {
          name: formName.trim(),
          description: formDesc.trim() || undefined,
          base_price_minor: parseInt(formPrice, 10) * 100,
          base_duration_minutes: parseInt(formDuration, 10),
          active: formActive,
          online_visible: formOnline,
          category_id: formCatId || undefined,
        },
        token,
        tenantId
      );
      onShowToast('Услуга успешно обновлена');
      loadData();
    } catch (err: any) {
      alert(`Ошибка сохранения: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Archive service
  const handleArchiveService = async () => {
    if (!selectedService) return;
    if (!window.confirm(`Архивировать услугу «${selectedService.name}»? Она будет скрыта из онлайн-записи, но история сохранится.`)) {
      return;
    }
    try {
      await api.deleteService(selectedService.id, token, tenantId);
      onShowToast('Услуга архивирована');
      loadData();
    } catch (err: any) {
      alert(`Ошибка архивации: ${err.message || err}`);
    }
  };

  // Create Category
  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    try {
      await api.createServiceCategory({ name: newCatName.trim(), sort_order: categories.length + 1 }, token, tenantId);
      setShowCatModal(false);
      setNewCatName('');
      onShowToast('Категория добавлена');
      loadData();
    } catch (err: any) {
      alert(`Ошибка создания категории: ${err.message || err}`);
    }
  };

  // Create Service
  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSvcName.trim()) return;
    try {
      await api.createService(
        {
          name: newSvcName.trim(),
          base_price_minor: parseInt(newSvcPrice, 10) * 100,
          base_duration_minutes: parseInt(newSvcDuration, 10),
          category_id: newSvcCatId || (categories[0]?.id || undefined),
          active: true,
          online_visible: true,
        },
        token,
        tenantId
      );
      setShowCreateSvcModal(false);
      setNewSvcName('');
      onShowToast('Услуга добавлена');
      loadData();
    } catch (err: any) {
      alert(`Ошибка создания услуги: ${err.message || err}`);
    }
  };

  return (
    <div style={{ height: 'calc(100vh - 64px)', display: 'flex', background: '#F8FAFC' }}>
      {/* Column 1: Categories (240px) */}
      <div
        style={{
          width: '240px',
          background: '#FFFFFF',
          borderRight: '1px solid #E2E8F0',
          padding: '16px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px 8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748B' }}>КАТЕГОРИИ</span>
          {userRole !== 'master' && (
            <button
              type="button"
              onClick={() => setShowCatModal(true)}
              style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
            >
              + Категория
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setActiveCategoryId(null)}
          style={{
            padding: '8px 12px',
            borderRadius: '8px',
            border: 'none',
            background: activeCategoryId === null ? '#EFF6FF' : 'transparent',
            color: activeCategoryId === null ? '#1D4ED8' : '#0F172A',
            fontWeight: activeCategoryId === null ? 600 : 500,
            fontSize: '14px',
            cursor: 'pointer',
            textAlign: 'left',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>Все категории</span>
          <span style={{ fontSize: '12px', color: '#64748B' }}>{services.length}</span>
        </button>

        {categories.map(c => {
          const count = services.filter(s => s.category_id === c.id).length;
          const isActive = activeCategoryId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveCategoryId(c.id)}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: 'none',
                background: isActive ? '#EFF6FF' : 'transparent',
                color: isActive ? '#1D4ED8' : '#0F172A',
                fontWeight: isActive ? 600 : 500,
                fontSize: '14px',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>{c.name}</span>
              <span style={{ fontSize: '12px', color: '#64748B' }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Column 2: Services List (340px) */}
      <div
        style={{
          width: '340px',
          background: '#FFFFFF',
          borderRight: '1px solid #E2E8F0',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '16px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '14px', fontWeight: 600 }}>Услуги ({filteredServices.length})</span>
          {userRole !== 'master' && (
            <button
              type="button"
              onClick={() => {
                if (categories.length > 0) setNewSvcCatId(categories[0].id);
                setShowCreateSvcModal(true);
              }}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: 'none',
                background: '#2563EB',
                color: '#FFFFFF',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + Услуга
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {filteredServices.map(s => {
            const isSelected = selectedService?.id === s.id;
            return (
              <div
                key={s.id}
                onClick={() => selectService(s)}
                style={{
                  padding: '12px',
                  borderRadius: '10px',
                  background: isSelected ? '#F1F5F9' : '#FFFFFF',
                  border: isSelected ? '1px solid #CBD5E1' : '1px solid transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  marginBottom: '4px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b style={{ fontSize: '14px' }}>{s.name}</b>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#1E293B' }}>
                    {(s.base_price_minor / 100).toLocaleString('ru-RU')} ₸
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: '#64748B', display: 'flex', gap: '8px' }}>
                  <span>{s.base_duration_minutes} мин</span>
                  <span>·</span>
                  <span>{s.active ? 'Активна' : 'Архив'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Column 3: Service Editor Form */}
      <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
        {selectedService ? (
          <form
            onSubmit={handleSaveService}
            style={{
              maxWidth: '540px',
              background: '#FFFFFF',
              borderRadius: '16px',
              border: '1px solid #E2E8F0',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Параметры услуги</h3>
              {userRole !== 'master' && (
                <button
                  type="button"
                  onClick={handleArchiveService}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: '1px solid #FCA5A5',
                    background: '#FEF2F2',
                    color: '#991B1B',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Архивировать
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Название услуги</label>
              <input
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                required
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Категория</label>
              <select
                value={formCatId}
                onChange={e => setFormCatId(e.target.value)}
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              >
                <option value="">Без категории</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>Базовая цена (₸)</label>
                <input
                  type="number"
                  value={formPrice}
                  onChange={e => setFormPrice(e.target.value)}
                  required
                  style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>Длительность (мин)</label>
                <input
                  type="number"
                  value={formDuration}
                  onChange={e => setFormDuration(e.target.value)}
                  required
                  style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Описание для клиента</label>
              <textarea
                value={formDesc}
                onChange={e => setFormDesc(e.target.value)}
                rows={3}
                placeholder="Что входит в услугу…"
                style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '8px', borderTop: '1px solid #F1F5F9' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={formActive}
                  onChange={e => setFormActive(e.target.checked)}
                />
                <span>Услуга активна в компании</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={formOnline}
                  onChange={e => setFormOnline(e.target.checked)}
                />
                <span>Отображать в онлайн-записи</span>
              </label>
            </div>

            {userRole !== 'master' && (
              <button
                type="submit"
                disabled={isSaving}
                style={{
                  marginTop: '12px',
                  height: '42px',
                  borderRadius: '10px',
                  border: 'none',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                }}
              >
                {isSaving ? 'Сохранение…' : 'Сохранить изменения'}
              </button>
            )}
          </form>
        ) : (
          <div style={{ padding: '32px', textAlign: 'center', color: '#64748B' }}>
            Выберите услугу из списка слева для просмотра и редактирования
          </div>
        )}
      </div>

      {/* Add Category Modal */}
      {showCatModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <form onSubmit={handleCreateCategory} style={{ width: '100%', maxWidth: '360px', background: '#FFFFFF', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Новая категория</h3>
            <input
              type="text"
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              placeholder="Стрижки, Борода, Уход…"
              required
              style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" onClick={() => setShowCatModal(false)} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFFFFF' }}>Отмена</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#2563EB', color: '#FFFFFF', fontWeight: 600 }}>Создать</button>
            </div>
          </form>
        </div>
      )}

      {/* Create Service Modal */}
      {showCreateSvcModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <form onSubmit={handleCreateService} style={{ width: '100%', maxWidth: '400px', background: '#FFFFFF', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Добавление услуги</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Название</label>
              <input type="text" value={newSvcName} onChange={e => setNewSvcName(e.target.value)} placeholder="Стрижка бороды" required style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }} />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>Цена (₸)</label>
                <input type="number" value={newSvcPrice} onChange={e => setNewSvcPrice(e.target.value)} required style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }} />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>Длительность</label>
                <input type="number" value={newSvcDuration} onChange={e => setNewSvcDuration(e.target.value)} required style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Категория</label>
              <select value={newSvcCatId} onChange={e => setNewSvcCatId(e.target.value)} style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button type="button" onClick={() => setShowCreateSvcModal(false)} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFFFFF' }}>Отмена</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#2563EB', color: '#FFFFFF', fontWeight: 600 }}>Добавить</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
