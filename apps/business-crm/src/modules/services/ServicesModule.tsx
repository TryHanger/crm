import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Plus,
  Trash2,
  Edit2,
  Clock,
  Check,
  AlertCircle,
  Tag,
  Building2,
  Sparkles,
} from 'lucide-react';
import { BusinessCrmApiClient, ServiceDetailResponse, ServiceCategoryResponse } from '@crm/api-client';

interface ServicesModuleProps {
  api: BusinessCrmApiClient;
  token: string;
  tenantId: string;
  onShowToast: (msg: string) => void;
  userRole: string;
  branches?: any[];
  selectedBranchId?: string | null;
}

export const ServicesModule: React.FC<ServicesModuleProps> = ({
  api,
  token,
  tenantId,
  onShowToast,
  userRole,
  branches = [],
  selectedBranchId,
}) => {
  const [categories, setCategories] = useState<ServiceCategoryResponse[]>([]);
  const [services, setServices] = useState<ServiceDetailResponse[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState<ServiceDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('all');

  // Form states for selected service
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPrice, setFormPrice] = useState('8000');
  const [formDuration, setFormDuration] = useState('45');
  const [formActive, setFormActive] = useState(true);
  const [formOnline, setFormOnline] = useState(true);
  const [formCatId, setFormCatId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Category modals
  const [showCatModal, setShowCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [showEditCatModal, setShowEditCatModal] = useState(false);
  const [editingCat, setEditingCat] = useState<ServiceCategoryResponse | null>(null);
  const [editCatName, setEditCatName] = useState('');

  // Service creation modal
  const [showCreateSvcModal, setShowCreateSvcModal] = useState(false);
  const [newSvcName, setNewSvcName] = useState('');
  const [newSvcPrice, setNewSvcPrice] = useState('8000');
  const [newSvcDuration, setNewSvcDuration] = useState('45');
  const [newSvcCatId, setNewSvcCatId] = useState('');
  const [newSvcDesc, setNewSvcDesc] = useState('');
  const [newSvcActive, setNewSvcActive] = useState(true);
  const [newSvcOnline, setNewSvcOnline] = useState(true);
  const [createSvcError, setCreateSvcError] = useState<string | null>(null);

  // Helper: Format duration minutes into human string
  const formatDurationText = (min: number) => {
    if (min <= 0 || isNaN(min)) return '0 мин';
    const hours = Math.floor(min / 60);
    const remainder = min % 60;
    if (hours > 0 && remainder > 0) return `${hours} ч ${remainder} мин`;
    if (hours > 0) return `${hours} ч`;
    return `${remainder} мин`;
  };

  // Helper: Format price tenge with thousands separator
  const formatTenge = (tenge: number) => {
    if (isNaN(tenge) || tenge < 0) return '0 ₸';
    return `${Math.round(tenge).toLocaleString('ru-RU')} ₸`;
  };

  // Current branch info
  const currentBranch = useMemo(() => {
    if (!branches || branches.length === 0) return null;
    return branches.find(b => b.id === selectedBranchId) || branches[0];
  }, [branches, selectedBranchId]);

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
    setFormPrice(String(Math.round(svc.base_price_minor / 100)));
    setFormDuration(String(svc.base_duration_minutes));
    setFormActive(svc.active);
    setFormOnline(svc.online_visible);
    setFormCatId(svc.category_id || '');
    setFormError(null);
  };

  // Filtered services
  const filteredServices = useMemo(() => {
    return services.filter(s => {
      // Category filter
      if (activeCategoryId && s.category_id !== activeCategoryId) return false;
      // Status filter
      if (statusFilter === 'active' && !s.active) return false;
      if (statusFilter === 'archived' && s.active) return false;
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = s.name.toLowerCase().includes(q);
        const matchesDesc = (s.description || '').toLowerCase().includes(q);
        if (!matchesName && !matchesDesc) return false;
      }
      return true;
    });
  }, [services, activeCategoryId, statusFilter, searchQuery]);

  // Save updated service
  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedService) return;

    const trimmedName = formName.trim();
    if (!trimmedName) {
      setFormError('Название услуги не может быть пустым');
      return;
    }

    const priceNum = parseFloat(formPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      setFormError('Укажите корректную стоимость (от 0 ₸)');
      return;
    }

    const durationNum = parseInt(formDuration, 10);
    if (isNaN(durationNum) || durationNum < 5 || durationNum > 720) {
      setFormError('Длительность должна быть от 5 до 720 минут (12 ч)');
      return;
    }

    setFormError(null);
    try {
      setIsSaving(true);
      await api.updateService(
        selectedService.id,
        {
          name: trimmedName,
          description: formDesc.trim() || undefined,
          base_price_minor: Math.round(priceNum * 100),
          base_duration_minutes: durationNum,
          active: formActive,
          online_visible: formOnline,
          category_id: formCatId || undefined,
        },
        token,
        tenantId
      );
      onShowToast(`Услуга «${trimmedName}» сохранена (${formatTenge(priceNum)})`);
      await loadData();
    } catch (err: any) {
      setFormError(`Ошибка сохранения: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Archive service
  const handleArchiveService = async () => {
    if (!selectedService) return;
    if (!window.confirm(`Архивировать услугу «${selectedService.name}»? Она будет скрыта из онлайн-записи, но история визитов сохранится.`)) {
      return;
    }
    try {
      await api.deleteService(selectedService.id, token, tenantId);
      onShowToast(`Услуга «${selectedService.name}» архивирована`);
      await loadData();
    } catch (err: any) {
      alert(`Ошибка архивации: ${err.message || err}`);
    }
  };

  // Create Category
  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    try {
      const created = await api.createServiceCategory(
        { name: trimmed, sort_order: categories.length + 1 },
        token,
        tenantId
      );
      setShowCatModal(false);
      setNewCatName('');
      onShowToast(`Категория «${trimmed}» добавлена`);
      await loadData();
      if (created?.id) setActiveCategoryId(created.id);
    } catch (err: any) {
      alert(`Ошибка создания категории: ${err.message || err}`);
    }
  };

  // Update Category
  const handleUpdateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCat || !editCatName.trim()) return;
    try {
      await api.updateServiceCategory(
        editingCat.id,
        { name: editCatName.trim() },
        token,
        tenantId
      );
      setShowEditCatModal(false);
      setEditingCat(null);
      setEditCatName('');
      onShowToast(`Категория переименована в «${editCatName.trim()}»`);
      await loadData();
    } catch (err: any) {
      alert(`Ошибка обновления категории: ${err.message || err}`);
    }
  };

  // Open Edit Category
  const openEditCategory = (cat: ServiceCategoryResponse, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCat(cat);
    setEditCatName(cat.name);
    setShowEditCatModal(true);
  };

  // Create Service
  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newSvcName.trim();
    if (!trimmedName) {
      setCreateSvcError('Укажите название услуги');
      return;
    }

    const priceNum = parseFloat(newSvcPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      setCreateSvcError('Укажите корректную стоимость');
      return;
    }

    const durNum = parseInt(newSvcDuration, 10);
    if (isNaN(durNum) || durNum < 5 || durNum > 720) {
      setCreateSvcError('Длительность должна быть от 5 до 720 минут');
      return;
    }

    setCreateSvcError(null);
    try {
      const created = await api.createService(
        {
          name: trimmedName,
          description: newSvcDesc.trim() || undefined,
          base_price_minor: Math.round(priceNum * 100),
          base_duration_minutes: durNum,
          category_id: newSvcCatId || (categories[0]?.id || undefined),
          active: newSvcActive,
          online_visible: newSvcOnline,
        },
        token,
        tenantId
      );
      setShowCreateSvcModal(false);
      setNewSvcName('');
      setNewSvcPrice('8000');
      setNewSvcDuration('45');
      setNewSvcDesc('');
      onShowToast(`Услуга «${trimmedName}» успешно создана за ${formatTenge(priceNum)}`);
      await loadData();
      if (created) selectService(created);
    } catch (err: any) {
      setCreateSvcError(`Ошибка создания услуги: ${err.message || err}`);
    }
  };

  // Quick preset handlers
  const setQuickPrice = (amount: number) => {
    setFormPrice(String(amount));
    setFormError(null);
  };

  const addQuickPrice = (delta: number) => {
    const cur = parseFloat(formPrice) || 0;
    setFormPrice(String(Math.max(0, cur + delta)));
    setFormError(null);
  };

  const setQuickDuration = (mins: number) => {
    setFormDuration(String(mins));
    setFormError(null);
  };

  const parsedFormPrice = parseFloat(formPrice) || 0;
  const parsedFormDuration = parseInt(formDuration, 10) || 0;

  return (
    <div style={{ height: 'calc(100vh - 64px)', display: 'flex', background: '#F8FAFC', overflow: 'hidden' }}>
      {/* Column 1: Categories Sidebar (250px) */}
      <div
        style={{
          width: '250px',
          background: '#FFFFFF',
          borderRight: '1px solid #E2E8F0',
          padding: '16px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Tag style={{ width: '15px', height: '15px', color: '#64748B' }} />
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569', letterSpacing: '0.04em' }}>КАТЕГОРИИ</span>
          </div>
          {userRole !== 'master' && (
            <button
              type="button"
              data-testid="add-category-btn"
              onClick={() => setShowCatModal(true)}
              style={{
                background: 'none',
                border: 'none',
                color: '#2563EB',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: '6px',
              }}
            >
              + Категория
            </button>
          )}
        </div>

        {/* All Categories Button */}
        <button
          type="button"
          onClick={() => setActiveCategoryId(null)}
          style={{
            padding: '10px 12px',
            borderRadius: '10px',
            border: 'none',
            background: activeCategoryId === null ? '#EFF6FF' : 'transparent',
            color: activeCategoryId === null ? '#1D4ED8' : '#1E293B',
            fontWeight: activeCategoryId === null ? 600 : 500,
            fontSize: '13.5px',
            cursor: 'pointer',
            textAlign: 'left',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            transition: 'all 0.15s ease',
          }}
        >
          <span>Все категории</span>
          <span style={{
            fontSize: '11px',
            padding: '2px 8px',
            borderRadius: '12px',
            background: activeCategoryId === null ? '#DBEAFE' : '#F1F5F9',
            color: activeCategoryId === null ? '#1E40AF' : '#64748B',
            fontWeight: 600,
          }}>
            {services.length}
          </span>
        </button>

        {/* Category List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, overflowY: 'auto' }}>
          {categories.map(c => {
            const count = services.filter(s => s.category_id === c.id).length;
            const isActive = activeCategoryId === c.id;
            return (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderRadius: '10px',
                  background: isActive ? '#EFF6FF' : 'transparent',
                  transition: 'background 0.15s ease',
                }}
              >
                <button
                  type="button"
                  onClick={() => setActiveCategoryId(c.id)}
                  style={{
                    flex: 1,
                    padding: '9px 12px',
                    border: 'none',
                    background: 'transparent',
                    color: isActive ? '#1D4ED8' : '#1E293B',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: '13px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.name}
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', paddingRight: '8px' }}>
                  <span style={{
                    fontSize: '11px',
                    padding: '2px 6px',
                    borderRadius: '10px',
                    background: isActive ? '#DBEAFE' : '#F1F5F9',
                    color: isActive ? '#1E40AF' : '#64748B',
                    fontWeight: 600,
                  }}>
                    {count}
                  </span>
                  {userRole !== 'master' && (
                    <button
                      type="button"
                      title="Редактировать категорию"
                      onClick={(e) => openEditCategory(c, e)}
                      style={{
                        padding: '4px',
                        border: 'none',
                        background: 'transparent',
                        color: '#94A3B8',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Edit2 style={{ width: '12px', height: '12px' }} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Branch Context Indicator in Sidebar Bottom */}
        {currentBranch && (
          <div style={{
            marginTop: 'auto',
            padding: '10px 12px',
            background: '#F1F5F9',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600, color: '#475569' }}>
              <Building2 style={{ width: '13px', height: '13px', color: '#2563EB' }} />
              <span>ТЕКУЩИЙ ФИЛИАЛ</span>
            </div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {currentBranch.name}
            </div>
            {currentBranch.city && (
              <div style={{ fontSize: '11px', color: '#64748B' }}>г. {currentBranch.city}</div>
            )}
          </div>
        )}
      </div>

      {/* Column 2: Services List (350px) */}
      <div
        style={{
          width: '350px',
          background: '#FFFFFF',
          borderRight: '1px solid #E2E8F0',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        {/* Top Action Bar */}
        <div style={{ padding: '16px', borderBottom: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#0F172A' }}>Услуги</span>
              <span style={{ fontSize: '13px', color: '#64748B', marginLeft: '6px' }}>({filteredServices.length})</span>
            </div>
            {userRole !== 'master' && (
              <button
                type="button"
                data-testid="add-service-btn"
                onClick={() => {
                  if (categories.length > 0) setNewSvcCatId(categories[0].id);
                  setNewSvcPrice('8000');
                  setNewSvcDuration('45');
                  setCreateSvcError(null);
                  setShowCreateSvcModal(true);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  borderRadius: '10px',
                  border: 'none',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(37,99,235,0.15)',
                }}
              >
                <Plus style={{ width: '14px', height: '14px' }} />
                <span>+ Услуга</span>
              </button>
            )}
          </div>

          {/* Search Box */}
          <div style={{ position: 'relative' }}>
            <Search style={{ position: 'absolute', left: '10px', top: '10px', width: '15px', height: '15px', color: '#94A3B8' }} />
            <input
              type="text"
              data-testid="services-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по названию услуги..."
              style={{
                width: '100%',
                height: '36px',
                padding: '0 10px 0 32px',
                borderRadius: '8px',
                border: '1px solid #CBD5E1',
                fontSize: '13px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Status Filter Chips */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: statusFilter === 'all' ? '#2563EB' : '#E2E8F0',
                background: statusFilter === 'all' ? '#EFF6FF' : '#FFFFFF',
                color: statusFilter === 'all' ? '#1D4ED8' : '#64748B',
                fontSize: '11.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Все
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('active')}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: statusFilter === 'active' ? '#059669' : '#E2E8F0',
                background: statusFilter === 'active' ? '#ECFDF5' : '#FFFFFF',
                color: statusFilter === 'active' ? '#047857' : '#64748B',
                fontSize: '11.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Активные
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('archived')}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: statusFilter === 'archived' ? '#991B1B' : '#E2E8F0',
                background: statusFilter === 'archived' ? '#FEF2F2' : '#FFFFFF',
                color: statusFilter === 'archived' ? '#991B1B' : '#64748B',
                fontSize: '11.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              В архиве
            </button>
          </div>
        </div>

        {/* Services List Scroll */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
          {isLoading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: '#64748B', fontSize: '13px' }}>
              Загрузка услуг...
            </div>
          ) : filteredServices.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#94A3B8' }}>
              <p style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 6px' }}>Услуг не найдено</p>
              <span style={{ fontSize: '12px' }}>
                {searchQuery ? 'Попробуйте изменить поисковый запрос' : 'Добавьте первую услугу кнопкой выше'}
              </span>
            </div>
          ) : (
            filteredServices.map(s => {
              const isSelected = selectedService?.id === s.id;
              const catObj = categories.find(c => c.id === s.category_id);
              const priceTenge = Math.round(s.base_price_minor / 100);

              return (
                <div
                  key={s.id}
                  data-testid={`service-item-${s.id}`}
                  onClick={() => selectService(s)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '12px',
                    background: isSelected ? '#EFF6FF' : '#FFFFFF',
                    border: isSelected ? '1.5px solid #3B82F6' : '1px solid #E2E8F0',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    marginBottom: '8px',
                    transition: 'all 0.15s ease',
                    boxShadow: isSelected ? '0 2px 6px rgba(59,130,246,0.1)' : '0 1px 2px rgba(0,0,0,0.02)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#0F172A', lineHeight: 1.3 }}>
                      {s.name}
                    </span>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#1D4ED8', whiteSpace: 'nowrap' }}>
                      {formatTenge(priceTenge)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#64748B' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock style={{ width: '13px', height: '13px', color: '#94A3B8' }} />
                      <span>{formatDurationText(s.base_duration_minutes)}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {catObj && (
                        <span style={{ fontSize: '11px', background: '#F1F5F9', color: '#475569', padding: '1px 6px', borderRadius: '4px' }}>
                          {catObj.name}
                        </span>
                      )}
                      <span style={{
                        fontSize: '11px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: s.active ? '#ECFDF5' : '#F1F5F9',
                        color: s.active ? '#059669' : '#94A3B8',
                        fontWeight: 600,
                      }}>
                        {s.active ? 'Активна' : 'Архив'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Column 3: Service Details & Full Editor Form */}
      <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
        {selectedService ? (
          <form
            onSubmit={handleSaveService}
            data-testid="service-edit-form"
            style={{
              maxWidth: '640px',
              background: '#FFFFFF',
              borderRadius: '20px',
              border: '1px solid #E2E8F0',
              padding: '28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            }}
          >
            {/* Form Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #F1F5F9', paddingBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 700, color: '#0F172A' }}>Параметры услуги</h3>
                <span style={{ fontSize: '12.5px', color: '#64748B' }}>Редактирование параметров стоимости, длительности и видимости</span>
              </div>
              {userRole !== 'master' && (
                <button
                  type="button"
                  data-testid="archive-service-btn"
                  onClick={handleArchiveService}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 14px',
                    borderRadius: '8px',
                    border: '1px solid #FCA5A5',
                    background: '#FEF2F2',
                    color: '#991B1B',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 style={{ width: '13px', height: '13px' }} />
                  <span>Архивировать</span>
                </button>
              )}
            </div>

            {formError && (
              <div style={{
                background: '#FEF2F2',
                border: '1px solid #FCA5A5',
                borderRadius: '10px',
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: '#DC2626',
                fontSize: '13px',
              }}>
                <AlertCircle style={{ width: '16px', height: '16px', flexShrink: 0 }} />
                <span>{formError}</span>
              </div>
            )}

            {/* Service Name */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                Название услуги <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <input
                type="text"
                data-testid="service-name-input"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                required
                placeholder="Например: Модельная мужская стрижка"
                style={{
                  height: '42px',
                  padding: '0 14px',
                  borderRadius: '10px',
                  border: '1px solid #CBD5E1',
                  fontSize: '14px',
                  outline: 'none',
                }}
              />
            </div>

            {/* Category */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Категория услуги</label>
              <select
                data-testid="service-category-select"
                value={formCatId}
                onChange={e => setFormCatId(e.target.value)}
                style={{
                  height: '42px',
                  padding: '0 12px',
                  borderRadius: '10px',
                  border: '1px solid #CBD5E1',
                  fontSize: '14px',
                  outline: 'none',
                  background: '#FFFFFF',
                }}
              >
                <option value="">Без категории</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Price & Duration Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              {/* Price with presets */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                    Базовая цена (₸) <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#2563EB' }}>
                    {formatTenge(parsedFormPrice)}
                  </span>
                </div>
                <input
                  type="number"
                  data-testid="service-price-input"
                  value={formPrice}
                  onChange={e => setFormPrice(e.target.value)}
                  required
                  min="0"
                  step="100"
                  placeholder="8000"
                  style={{
                    height: '42px',
                    padding: '0 14px',
                    borderRadius: '10px',
                    border: '1px solid #CBD5E1',
                    fontSize: '15px',
                    fontWeight: 600,
                    outline: 'none',
                  }}
                />
                {/* Quick Price Preset Chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
                  {[5000, 7000, 8000, 10000, 15000].map(p => (
                    <button
                      key={p}
                      type="button"
                      data-testid={`quick-price-${p}`}
                      onClick={() => setQuickPrice(p)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        border: parsedFormPrice === p ? '1px solid #2563EB' : '1px solid #E2E8F0',
                        background: parsedFormPrice === p ? '#EFF6FF' : '#F8FAFC',
                        color: parsedFormPrice === p ? '#1D4ED8' : '#475569',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {p.toLocaleString('ru-RU')} ₸
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => addQuickPrice(500)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: '6px',
                      border: '1px solid #E2E8F0',
                      background: '#F8FAFC',
                      color: '#475569',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    +500
                  </button>
                  <button
                    type="button"
                    onClick={() => addQuickPrice(1000)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: '6px',
                      border: '1px solid #E2E8F0',
                      background: '#F8FAFC',
                      color: '#475569',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    +1 000
                  </button>
                </div>
              </div>

              {/* Duration with presets */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                    Длительность (мин) <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#2563EB' }}>
                    {formatDurationText(parsedFormDuration)}
                  </span>
                </div>
                <input
                  type="number"
                  data-testid="service-duration-input"
                  value={formDuration}
                  onChange={e => setFormDuration(e.target.value)}
                  required
                  min="5"
                  max="720"
                  step="5"
                  placeholder="45"
                  style={{
                    height: '42px',
                    padding: '0 14px',
                    borderRadius: '10px',
                    border: '1px solid #CBD5E1',
                    fontSize: '15px',
                    fontWeight: 600,
                    outline: 'none',
                  }}
                />
                {/* Quick Duration Preset Chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
                  {[15, 30, 45, 60, 90, 120].map(d => (
                    <button
                      key={d}
                      type="button"
                      data-testid={`quick-dur-${d}`}
                      onClick={() => setQuickDuration(d)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        border: parsedFormDuration === d ? '1px solid #2563EB' : '1px solid #E2E8F0',
                        background: parsedFormDuration === d ? '#EFF6FF' : '#F8FAFC',
                        color: parsedFormDuration === d ? '#1D4ED8' : '#475569',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {d} мин
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Description */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Описание для клиента</label>
                <span style={{ fontSize: '11px', color: '#94A3B8' }}>{formDesc.length} / 500 символов</span>
              </div>
              <textarea
                data-testid="service-desc-input"
                value={formDesc}
                onChange={e => setFormDesc(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Что входит в услугу (мытье головы, укладка, консультация стилиста)…"
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid #CBD5E1',
                  fontSize: '13.5px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
            </div>

            {/* Toggles */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '10px', borderTop: '1px solid #F1F5F9' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13.5px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  data-testid="service-active-toggle"
                  checked={formActive}
                  onChange={e => setFormActive(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#2563EB' }}
                />
                <div>
                  <span style={{ fontWeight: 600, color: '#1E293B' }}>Услуга активна в компании</span>
                  <p style={{ margin: 0, fontSize: '11.5px', color: '#64748B' }}>
                    Сотрудники могут добавлять эту услугу при записи вручную через журнал
                  </p>
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13.5px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  data-testid="service-online-toggle"
                  checked={formOnline}
                  onChange={e => setFormOnline(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#2563EB' }}
                />
                <div>
                  <span style={{ fontWeight: 600, color: '#1E293B' }}>Отображать на сайте онлайн-записи</span>
                  <p style={{ margin: 0, fontSize: '11.5px', color: '#64748B' }}>
                    Клиенты увидят услугу с ценой {formatTenge(parsedFormPrice)} при бронировании
                  </p>
                </div>
              </label>
            </div>

            {/* Save Button */}
            {userRole !== 'master' && (
              <button
                type="submit"
                data-testid="save-service-btn"
                disabled={isSaving}
                style={{
                  marginTop: '10px',
                  height: '46px',
                  borderRadius: '12px',
                  border: 'none',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                  boxShadow: '0 2px 6px rgba(37,99,235,0.2)',
                  transition: 'background 0.15s ease',
                }}
              >
                {isSaving ? 'Сохранение...' : 'Сохранить изменения'}
              </button>
            )}
          </form>
        ) : (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748B' }}>
            <Sparkles style={{ width: '32px', height: '32px', color: '#94A3B8', margin: '0 auto 12px' }} />
            <h4 style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 600, color: '#1E293B' }}>
              Выберите услугу из списка
            </h4>
            <p style={{ margin: 0, fontSize: '13px' }}>
              Кликните по любой услуге слева для редактирования цены, длительности и видимости
            </p>
          </div>
        )}
      </div>

      {/* Add Category Modal */}
      {showCatModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <form
            onSubmit={handleCreateCategory}
            style={{ width: '100%', maxWidth: '380px', background: '#FFFFFF', borderRadius: '18px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}
          >
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>Новая категория услуг</h3>
            <p style={{ margin: '-8px 0 0', fontSize: '13px', color: '#64748B' }}>Например: Стрижки, Борода, Комплексы, СПА</p>
            <input
              type="text"
              data-testid="new-category-name-input"
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              placeholder="Название категории"
              required
              autoFocus
              style={{ height: '42px', padding: '0 14px', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '14px', outline: 'none' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
              <button
                type="button"
                onClick={() => setShowCatModal(false)}
                style={{ padding: '9px 16px', borderRadius: '10px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#475569', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                Отмена
              </button>
              <button
                type="submit"
                data-testid="submit-create-category-btn"
                style={{ padding: '9px 18px', borderRadius: '10px', border: 'none', background: '#2563EB', color: '#FFFFFF', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
              >
                Создать
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Category Modal */}
      {showEditCatModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <form
            onSubmit={handleUpdateCategory}
            style={{ width: '100%', maxWidth: '380px', background: '#FFFFFF', borderRadius: '18px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}
          >
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>Редактирование категории</h3>
            <input
              type="text"
              value={editCatName}
              onChange={e => setEditCatName(e.target.value)}
              placeholder="Название категории"
              required
              autoFocus
              style={{ height: '42px', padding: '0 14px', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '14px', outline: 'none' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
              <button
                type="button"
                onClick={() => { setShowEditCatModal(false); setEditingCat(null); }}
                style={{ padding: '9px 16px', borderRadius: '10px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#475569', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                Отмена
              </button>
              <button
                type="submit"
                style={{ padding: '9px 18px', borderRadius: '10px', border: 'none', background: '#2563EB', color: '#FFFFFF', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
              >
                Сохранить
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Create Service Modal */}
      {showCreateSvcModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <form
            onSubmit={handleCreateService}
            data-testid="create-service-form"
            style={{ width: '100%', maxWidth: '460px', background: '#FFFFFF', borderRadius: '20px', padding: '28px', display: 'flex', flexDirection: 'column', gap: '16px', boxShadow: '0 12px 30px rgba(0,0,0,0.12)' }}
          >
            <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 700, color: '#0F172A' }}>Добавление услуги</h3>

            {createSvcError && (
              <div style={{
                background: '#FEF2F2',
                border: '1px solid #FCA5A5',
                borderRadius: '8px',
                padding: '8px 12px',
                color: '#DC2626',
                fontSize: '12.5px',
              }}>
                {createSvcError}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                Название услуги <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <input
                type="text"
                data-testid="new-service-name-input"
                value={newSvcName}
                onChange={e => setNewSvcName(e.target.value)}
                placeholder="Стрижка бороды"
                required
                autoFocus
                style={{ height: '40px', padding: '0 12px', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '14px', outline: 'none' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Цена (₸)</label>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#2563EB' }}>
                    {formatTenge(parseFloat(newSvcPrice) || 0)}
                  </span>
                </div>
                <input
                  type="number"
                  data-testid="new-service-price-input"
                  value={newSvcPrice}
                  onChange={e => setNewSvcPrice(e.target.value)}
                  required
                  min="0"
                  step="100"
                  style={{ height: '40px', padding: '0 12px', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '14px', outline: 'none' }}
                />
                {/* 8000 KZT button */}
                <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                  {[5000, 7000, 8000, 10000].map(p => (
                    <button
                      key={p}
                      type="button"
                      data-testid={`modal-quick-price-${p}`}
                      onClick={() => setNewSvcPrice(String(p))}
                      style={{
                        padding: '2px 6px',
                        borderRadius: '5px',
                        border: '1px solid #E2E8F0',
                        background: newSvcPrice === String(p) ? '#EFF6FF' : '#F8FAFC',
                        color: newSvcPrice === String(p) ? '#1D4ED8' : '#475569',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Длительность</label>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#2563EB' }}>
                    {formatDurationText(parseInt(newSvcDuration, 10) || 0)}
                  </span>
                </div>
                <input
                  type="number"
                  data-testid="new-service-duration-input"
                  value={newSvcDuration}
                  onChange={e => setNewSvcDuration(e.target.value)}
                  required
                  min="5"
                  max="720"
                  step="5"
                  style={{ height: '40px', padding: '0 12px', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '14px', outline: 'none' }}
                />
                <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                  {[30, 45, 60, 90].map(d => (
                    <button
                      key={d}
                      type="button"
                      data-testid={`modal-quick-dur-${d}`}
                      onClick={() => setNewSvcDuration(String(d))}
                      style={{
                        padding: '2px 6px',
                        borderRadius: '5px',
                        border: '1px solid #E2E8F0',
                        background: newSvcDuration === String(d) ? '#EFF6FF' : '#F8FAFC',
                        color: newSvcDuration === String(d) ? '#1D4ED8' : '#475569',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {d}м
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Категория</label>
              <select
                value={newSvcCatId}
                onChange={e => setNewSvcCatId(e.target.value)}
                style={{ height: '40px', padding: '0 12px', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '14px', outline: 'none', background: '#FFFFFF' }}
              >
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Описание (необязательно)</label>
              <textarea
                value={newSvcDesc}
                onChange={e => setNewSvcDesc(e.target.value)}
                rows={2}
                placeholder="Что входит в услугу…"
                style={{ padding: '8px 12px', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '13px', outline: 'none', fontFamily: 'inherit' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '16px', paddingTop: '4px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={newSvcActive} onChange={e => setNewSvcActive(e.target.checked)} style={{ accentColor: '#2563EB' }} />
                <span>Активна</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={newSvcOnline} onChange={e => setNewSvcOnline(e.target.checked)} style={{ accentColor: '#2563EB' }} />
                <span>Онлайн-запись</span>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button
                type="button"
                onClick={() => setShowCreateSvcModal(false)}
                style={{ padding: '9px 16px', borderRadius: '10px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#475569', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                Отмена
              </button>
              <button
                type="submit"
                data-testid="submit-create-service-btn"
                style={{ padding: '9px 18px', borderRadius: '10px', border: 'none', background: '#2563EB', color: '#FFFFFF', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
              >
                Добавить
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
