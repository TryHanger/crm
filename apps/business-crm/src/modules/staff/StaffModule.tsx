import React, { useState, useEffect } from 'react';
import { BusinessCrmApiClient, StaffDetailResponse } from '@crm/api-client';

interface StaffModuleProps {
  api: BusinessCrmApiClient;
  token: string;
  tenantId: string;
  branches: any[];
  onShowToast: (msg: string) => void;
  userRole: string;
}

export const StaffModule: React.FC<StaffModuleProps> = ({
  api,
  token,
  tenantId,
  branches,
  onShowToast,
  userRole,
}) => {
  const [staffList, setStaffList] = useState<StaffDetailResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [staffDetail, setStaffDetail] = useState<StaffDetailResponse | null>(null);
  const [profileTab, setProfileTab] = useState<'profile' | 'services' | 'schedule'>('profile');

  // Add staff modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState('');
  const [addTitle, setAddTitle] = useState('Барбер');
  const [addColor, setAddColor] = useState('#2563EB');
  const [addBranchId, setAddBranchId] = useState(branches[0]?.id || '');
  const [modalBranchId, setModalBranchId] = useState<string>(branches[0]?.id || '');
  const [isLoadingBranchData, setIsLoadingBranchData] = useState(false);

  // Schedule state
  const [scheduleShifts, setScheduleShifts] = useState<any[]>([]);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // Services offer state
  const [allServices, setAllServices] = useState<any[]>([]);
  const [customOffers, setCustomOffers] = useState<Record<string, { price: string; duration: string; active: boolean }>>({});
  const [isSavingOffers, setIsSavingOffers] = useState(false);

  // Fetch staff list
  const fetchStaff = async () => {
    try {
      setIsLoading(true);
      const list = await api.getStaff({}, token, tenantId);
      setStaffList(list || []);
    } catch (err: any) {
      console.error('Failed to load staff', err);
      setStaffList([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStaff();
  }, []);

  const loadBranchSpecificData = async (staffId: string, bId: string, currentDetail?: any) => {
    setIsLoadingBranchData(true);
    try {
      const detail = currentDetail || (await api.getStaffDetail(staffId, token, tenantId));
      if (!currentDetail) setStaffDetail(detail);

      // 1. Load schedule strictly for this branch
      const sched = await api.getStaffSchedule(staffId, token, tenantId, bId);
      const days = [1, 2, 3, 4, 5, 6, 7];
      const fullSched = days.map(d => {
        const found = sched.find(s => s.weekday_iso === d);
        return found || {
          weekday_iso: d,
          local_start: '10:00',
          local_end: '20:00',
          is_working: d !== 7,
          breaks: [{ local_start: '14:00', local_end: '15:00' }],
        };
      });
      setScheduleShifts(fullSched);

      // 2. Load services
      const svcs = await api.getServices({}, token, tenantId);
      setAllServices(svcs || []);

      // 3. Filter offers strictly for this branch
      const offersMap: Record<string, any> = {};
      detail.offers?.forEach((off: any) => {
        if (off.branch_id === bId) {
          offersMap[off.service_id] = {
            price: off.price_override_minor ? String(off.price_override_minor / 100) : '',
            duration: off.duration_override_minutes ? String(off.duration_override_minutes) : '',
            active: off.active,
          };
        }
      });
      setCustomOffers(offersMap);
    } catch (err: any) {
      console.error('Failed to load branch data for staff', err);
    } finally {
      setIsLoadingBranchData(false);
    }
  };

  // Open staff modal
  const handleOpenStaffModal = async (id: string) => {
    setSelectedStaffId(id);
    setProfileTab('profile');
    const defaultBranchId = modalBranchId || branches[0]?.id || '';
    try {
      const detail = await api.getStaffDetail(id, token, tenantId);
      setStaffDetail(detail);
      await loadBranchSpecificData(id, defaultBranchId, detail);
    } catch (err: any) {
      alert(`Ошибка загрузки данных сотрудника: ${err.message || err}`);
    }
  };

  // Add staff
  const handleAddStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim()) return;
    try {
      let branchId = addBranchId || modalBranchId || branches[0]?.id;
      if (!branchId) {
        const bList = await api.getBranches(token, tenantId);
        if (bList && bList.length > 0) branchId = bList[0].id;
      }
      await api.createStaff(
        {
          display_name: addName.trim(),
          role_title: addTitle.trim(),
          color: addColor,
          online_bookable: true,
          branch_ids: branchId ? [branchId] : [],
        },
        token,
        tenantId
      );
      setShowAddModal(false);
      setAddName('');
      onShowToast('Сотрудник добавлен');
      fetchStaff();
    } catch (err: any) {
      alert(`Ошибка добавления сотрудника: ${err.message || err}`);
    }
  };

  // Save schedule
  const handleSaveSchedule = async () => {
    if (!selectedStaffId) return;
    try {
      setIsSavingSchedule(true);
      const targetBranchId = modalBranchId || branches[0]?.id;
      await api.updateStaffSchedule(selectedStaffId, scheduleShifts, token, tenantId, targetBranchId);
      onShowToast('График работы сохранен');
    } catch (err: any) {
      alert(`Ошибка сохранения графика: ${err.message || err}`);
    } finally {
      setIsSavingSchedule(false);
    }
  };

  // Save service overrides
  const handleSaveOffers = async () => {
    if (!selectedStaffId || !staffDetail) return;
    try {
      setIsSavingOffers(true);
      const targetBranchId = modalBranchId || branches[0]?.id;
      const payload = Object.entries(customOffers).map(([svcId, val]) => ({
        branch_id: targetBranchId,
        service_id: svcId,
        price_override_minor: val.price ? parseInt(val.price, 10) * 100 : undefined,
        duration_override_minutes: val.duration ? parseInt(val.duration, 10) : undefined,
        active: val.active,
        online_visible: val.active,
      }));

      await api.updateStaffServices(selectedStaffId, payload, token, tenantId);
      onShowToast('Индивидуальные цены сохранены');
    } catch (err: any) {
      alert(`Ошибка сохранения цен: ${err.message || err}`);
    } finally {
      setIsSavingOffers(false);
    }
  };

  const dayNames = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top action row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Команда барбершопа</h2>
          <div style={{ fontSize: '13px', color: '#64748B' }}>
            Всего специалистов: {staffList.length}
          </div>
        </div>

        {userRole !== 'master' && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            style={{
              height: '40px',
              padding: '0 16px',
              borderRadius: '10px',
              border: 'none',
              background: '#2563EB',
              color: '#FFFFFF',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Сотрудник
          </button>
        )}
      </div>

      {/* Staff Table */}
      <div style={{ background: '#FFFFFF', borderRadius: '16px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', color: '#64748B' }}>
              <th style={{ padding: '12px 16px' }}>Сотрудник</th>
              <th style={{ padding: '12px 16px' }}>Должность</th>
              <th style={{ padding: '12px 16px' }}>Онлайн-запись</th>
              <th style={{ padding: '12px 16px' }}>Статус</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={4} style={{ padding: '32px', textAlign: 'center', color: '#64748B' }}>
                  Загрузка команды…
                </td>
              </tr>
            ) : staffList.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: '32px', textAlign: 'center', color: '#64748B' }}>
                  Сотрудники не добавлены
                </td>
              </tr>
            ) : (
              staffList.map(s => (
                <tr
                  key={s.id}
                  onClick={() => handleOpenStaffModal(s.id)}
                  style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer', transition: 'background 0.1s ease' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: s.color || '#2563EB',
                        color: '#FFFFFF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: 700,
                      }}
                    >
                      {s.display_name.slice(0, 2).toUpperCase()}
                    </div>
                    <b>{s.display_name}</b>
                  </td>
                  <td style={{ padding: '12px 16px' }}>{s.role_title || 'Барбер'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      style={{
                        fontSize: '12px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontWeight: 600,
                        background: s.online_bookable ? '#DCFCE7' : '#F1F5F9',
                        color: s.online_bookable ? '#15803D' : '#64748B',
                      }}
                    >
                      {s.online_bookable ? 'Доступен' : 'Отключен'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      style={{
                        fontSize: '12px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontWeight: 600,
                        background: s.active ? '#EFF6FF' : '#FEE2E2',
                        color: s.active ? '#1D4ED8' : '#991B1B',
                      }}
                    >
                      {s.active ? 'Активен' : 'В архиве'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Staff Profile & Settings Modal */}
      {selectedStaffId && staffDetail && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.4)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '680px',
              background: '#FFFFFF',
              borderRadius: '20px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: staffDetail.color || '#2563EB',
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                  }}
                >
                  {staffDetail.display_name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Сотрудник: {staffDetail.display_name}</h3>
                  <div style={{ fontSize: '13px', color: '#64748B' }}>{staffDetail.role_title}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStaffId(null)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Profile Tabs */}
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #E2E8F0', paddingBottom: '8px' }}>
              <button
                type="button"
                onClick={() => setProfileTab('profile')}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: profileTab === 'profile' ? '#EFF6FF' : 'transparent',
                  color: profileTab === 'profile' ? '#1D4ED8' : '#64748B',
                  fontWeight: profileTab === 'profile' ? 600 : 500,
                  cursor: 'pointer',
                }}
              >
                Профиль
              </button>
              <button
                type="button"
                onClick={() => setProfileTab('services')}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: profileTab === 'services' ? '#EFF6FF' : 'transparent',
                  color: profileTab === 'services' ? '#1D4ED8' : '#64748B',
                  fontWeight: profileTab === 'services' ? 600 : 500,
                  cursor: 'pointer',
                }}
              >
                Услуги и цены
              </button>
              <button
                type="button"
                onClick={() => setProfileTab('schedule')}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: profileTab === 'schedule' ? '#EFF6FF' : 'transparent',
                  color: profileTab === 'schedule' ? '#1D4ED8' : '#64748B',
                  fontWeight: profileTab === 'schedule' ? 600 : 500,
                  cursor: 'pointer',
                }}
              >
                График работы
              </button>
            </div>

            {/* Tab: Profile */}
            {profileTab === 'profile' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div><b>ФИО:</b> {staffDetail.display_name}</div>
                <div><b>Должность:</b> {staffDetail.role_title}</div>
                <div><b>Цвет карточки:</b> <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: staffDetail.color, verticalAlign: 'middle', marginRight: '4px' }}></span> {staffDetail.color}</div>
                <div><b>Онлайн-запись:</b> {staffDetail.online_bookable ? 'Разрешена клиентам' : 'Только для внутренней записи'}</div>
              </div>
            )}

            {/* Tab: Services & Custom Pricing */}
            {profileTab === 'services' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {branches.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748B' }}>Филиал:</span>
                    <select
                      value={modalBranchId}
                      onChange={e => {
                        const newBid = e.target.value;
                        setModalBranchId(newBid);
                        if (selectedStaffId) loadBranchSpecificData(selectedStaffId, newBid);
                      }}
                      style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px' }}
                    >
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <p style={{ margin: 0, fontSize: '13px', color: '#64748B' }}>
                  Назначьте услуги и укажите индивидуальные цены или длительность мастера (например, топ-барбера):
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                  {allServices.map(svc => {
                    const off = customOffers[svc.id] || { price: '', duration: '', active: false };
                    return (
                      <div
                        key={svc.id}
                        style={{
                          padding: '10px',
                          border: '1px solid #E2E8F0',
                          borderRadius: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={off.active}
                          onChange={e => {
                            setCustomOffers({
                              ...customOffers,
                              [svc.id]: { ...off, active: e.target.checked },
                            });
                          }}
                        />
                        <div style={{ flex: 1 }}>
                          <b>{svc.name}</b>
                          <div style={{ fontSize: '12px', color: '#64748B' }}>
                            Базовая цена: {(svc.base_price_minor / 100).toLocaleString('ru-RU')} ₸ ({svc.base_duration_minutes} мин)
                          </div>
                        </div>
                        {off.active && (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <input
                              type="number"
                              value={off.price}
                              placeholder="Цена ₸"
                              onChange={e => {
                                setCustomOffers({
                                  ...customOffers,
                                  [svc.id]: { ...off, price: e.target.value },
                                });
                              }}
                              style={{ width: '80px', height: '32px', padding: '0 6px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px' }}
                            />
                            <input
                              type="number"
                              value={off.duration}
                              placeholder="Мин"
                              onChange={e => {
                                setCustomOffers({
                                  ...customOffers,
                                  [svc.id]: { ...off, duration: e.target.value },
                                });
                              }}
                              style={{ width: '60px', height: '32px', padding: '0 6px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px' }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={handleSaveOffers}
                  disabled={isSavingOffers}
                  style={{ alignSelf: 'flex-end', padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#2563EB', color: '#FFFFFF', fontWeight: 600, cursor: 'pointer' }}
                >
                  {isSavingOffers ? 'Сохранение…' : 'Сохранить цены'}
                </button>
              </div>
            )}

            {/* Tab: Weekly Schedule */}
            {profileTab === 'schedule' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {branches.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748B' }}>Филиал:</span>
                    <select
                      value={modalBranchId}
                      onChange={e => {
                        const newBid = e.target.value;
                        setModalBranchId(newBid);
                        if (selectedStaffId) loadBranchSpecificData(selectedStaffId, newBid);
                      }}
                      style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px' }}
                    >
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <p style={{ margin: 0, fontSize: '13px', color: '#64748B' }}>
                  Настройте рабочие часы и обеденные перерывы мастера по дням недели:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto' }}>
                  {scheduleShifts.map((shift, idx) => (
                    <div
                      key={shift.weekday_iso}
                      style={{
                        padding: '10px',
                        border: '1px solid #E2E8F0',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                      }}
                    >
                      <div style={{ width: '110px', fontWeight: 600, fontSize: '13px' }}>
                        {dayNames[shift.weekday_iso - 1]}
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                        <input
                          type="checkbox"
                          checked={shift.is_working}
                          onChange={e => {
                            const copy = [...scheduleShifts];
                            copy[idx].is_working = e.target.checked;
                            setScheduleShifts(copy);
                          }}
                        />
                        <span>{shift.is_working ? 'Рабочий' : 'Выходной'}</span>
                      </label>
                      {shift.is_working && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="time"
                            value={shift.local_start}
                            onChange={e => {
                              const copy = [...scheduleShifts];
                              copy[idx].local_start = e.target.value;
                              setScheduleShifts(copy);
                            }}
                            style={{ height: '30px', borderRadius: '6px', border: '1px solid #CBD5E1', padding: '0 4px', fontSize: '12px' }}
                          />
                          <span>–</span>
                          <input
                            type="time"
                            value={shift.local_end}
                            onChange={e => {
                              const copy = [...scheduleShifts];
                              copy[idx].local_end = e.target.value;
                              setScheduleShifts(copy);
                            }}
                            style={{ height: '30px', borderRadius: '6px', border: '1px solid #CBD5E1', padding: '0 4px', fontSize: '12px' }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleSaveSchedule}
                  disabled={isSavingSchedule}
                  style={{ alignSelf: 'flex-end', padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#0F172A', color: '#FFFFFF', fontWeight: 600, cursor: 'pointer' }}
                >
                  {isSavingSchedule ? 'Сохранение…' : 'Сохранить график'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Staff Modal */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.4)',
            zIndex: 110,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <form
            onSubmit={handleAddStaffSubmit}
            style={{
              width: '100%',
              maxWidth: '400px',
              background: '#FFFFFF',
              borderRadius: '20px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Добавление сотрудника</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Имя мастера</label>
              <input
                type="text"
                value={addName}
                onChange={e => setAddName(e.target.value)}
                placeholder="Руслан Ибрагимов"
                required
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Должность</label>
              <input
                type="text"
                value={addTitle}
                onChange={e => setAddTitle(e.target.value)}
                placeholder="Барбер, Топ-барбер"
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Цвет в календаре</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="color"
                  value={addColor}
                  onChange={e => setAddColor(e.target.value)}
                  style={{ width: '40px', height: '40px', border: 'none', background: 'none', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '13px', color: '#64748B' }}>{addColor}</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFFFFF' }}
              >
                Отмена
              </button>
              <button
                type="submit"
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#2563EB', color: '#FFFFFF', fontWeight: 600 }}
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
