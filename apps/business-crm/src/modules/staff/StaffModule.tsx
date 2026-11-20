import React, { useState, useEffect } from 'react';
import { BusinessCrmApiClient, StaffDetailResponse, StaffTimeOffResponse } from '@crm/api-client';

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
  const [profileTab, setProfileTab] = useState<'profile' | 'services' | 'schedule' | 'timeoff'>('profile');

  // Add staff modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState('');
  const [addTitle, setAddTitle] = useState('Барбер');
  const [addColor, setAddColor] = useState('var(--brand)');
  const [addBranchId, setAddBranchId] = useState(branches[0]?.id || '');
  const [modalBranchId, setModalBranchId] = useState<string>(branches[0]?.id || '');
  const [isLoadingBranchData, setIsLoadingBranchData] = useState(false);

  // Profile editing state
  const [editName, setEditName] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editColor, setEditColor] = useState('var(--brand)');
  const [editOnlineBookable, setEditOnlineBookable] = useState(true);
  const [editActive, setEditActive] = useState(true);
  const [editBranchIds, setEditBranchIds] = useState<string[]>([]);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Schedule & Breaks state
  const [scheduleShifts, setScheduleShifts] = useState<any[]>([]);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // Services offer state
  const [allServices, setAllServices] = useState<any[]>([]);
  const [customOffers, setCustomOffers] = useState<Record<string, { price: string; duration: string; active: boolean }>>({});
  const [isSavingOffers, setIsSavingOffers] = useState(false);

  // Time off / Vacations state
  const [timeOffList, setTimeOffList] = useState<StaffTimeOffResponse[]>([]);
  const [isLoadingTimeOff, setIsLoadingTimeOff] = useState(false);
  const [newTimeOffFrom, setNewTimeOffFrom] = useState('');
  const [newTimeOffTo, setNewTimeOffTo] = useState('');
  const [newTimeOffReason, setNewTimeOffReason] = useState('Ежегодный отпуск');
  const [isAddingTimeOff, setIsAddingTimeOff] = useState(false);

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

  const loadTimeOff = async (staffId: string) => {
    try {
      setIsLoadingTimeOff(true);
      const res = await api.getStaffTimeOff(staffId, token, tenantId);
      setTimeOffList(res || []);
    } catch (err: any) {
      console.error('Failed to load staff time-off', err);
      setTimeOffList([]);
    } finally {
      setIsLoadingTimeOff(false);
    }
  };

  const loadBranchSpecificData = async (staffId: string, bId: string, currentDetail?: any) => {
    setIsLoadingBranchData(true);
    try {
      const detail = currentDetail || (await api.getStaffDetail(staffId, token, tenantId));
      if (!currentDetail) setStaffDetail(detail);

      // Populate profile edit form
      setEditName(detail.display_name || '');
      setEditTitle(detail.role_title || '');
      setEditColor(detail.color || 'var(--brand)');
      setEditOnlineBookable(detail.online_bookable !== false);
      setEditActive(detail.active !== false);
      setEditBranchIds(detail.branch_ids || []);

      // 1. Load schedule strictly for this branch
      const sched = await api.getStaffSchedule(staffId, token, tenantId, bId);
      const days = [1, 2, 3, 4, 5, 6, 7];
      const fullSched = days.map(d => {
        const found = (sched || []).find((s: any) => s.weekday_iso === d);
        if (found) {
          return {
            weekday_iso: d,
            local_start: found.local_start || '10:00',
            local_end: found.local_end || '20:00',
            is_working: found.is_working !== false,
            breaks: found.breaks || [],
          };
        }
        return {
          weekday_iso: d,
          local_start: '10:00',
          local_end: '20:00',
          is_working: d !== 7,
          breaks: d !== 7 ? [{ local_start: '14:00', local_end: '15:00' }] : [],
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

      // 4. Load time-off
      await loadTimeOff(staffId);
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

  // Save profile & branch assignments
  const handleSaveProfile = async () => {
    if (!selectedStaffId) return;
    try {
      setIsSavingProfile(true);
      await api.updateStaff(
        selectedStaffId,
        {
          display_name: editName.trim(),
          role_title: editTitle.trim(),
          color: editColor,
          online_bookable: editOnlineBookable,
          active: editActive,
          branch_ids: editBranchIds,
        } as any,
        token,
        tenantId
      );
      onShowToast('Профиль и филиалы сотрудника сохранены');
      const updated = await api.getStaffDetail(selectedStaffId, token, tenantId);
      setStaffDetail(updated);
      fetchStaff();
    } catch (err: any) {
      alert(`Ошибка сохранения профиля: ${err.message || err}`);
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Save schedule & breaks
  const handleSaveSchedule = async () => {
    if (!selectedStaffId) return;
    try {
      setIsSavingSchedule(true);
      const targetBranchId = modalBranchId || branches[0]?.id;
      await api.updateStaffSchedule(selectedStaffId, scheduleShifts, token, tenantId, targetBranchId);
      onShowToast('График работы и перерывы сохранены');
    } catch (err: any) {
      alert(`Ошибка сохранения графика: ${err.message || err}`);
    } finally {
      setIsSavingSchedule(false);
    }
  };

  // Breaks helper
  const handleAddBreak = (weekdayIso: number) => {
    setScheduleShifts(prev =>
      prev.map(s => {
        if (s.weekday_iso === weekdayIso) {
          const currentBreaks = s.breaks || [];
          return {
            ...s,
            breaks: [...currentBreaks, { local_start: '14:00', local_end: '15:00' }],
          };
        }
        return s;
      })
    );
  };

  const handleRemoveBreak = (weekdayIso: number, breakIdx: number) => {
    setScheduleShifts(prev =>
      prev.map(s => {
        if (s.weekday_iso === weekdayIso) {
          const updatedBreaks = (s.breaks || []).filter((_: any, i: number) => i !== breakIdx);
          return { ...s, breaks: updatedBreaks };
        }
        return s;
      })
    );
  };

  const handleBreakChange = (
    weekdayIso: number,
    breakIdx: number,
    field: 'local_start' | 'local_end',
    val: string
  ) => {
    setScheduleShifts(prev =>
      prev.map(s => {
        if (s.weekday_iso === weekdayIso) {
          const updatedBreaks = [...(s.breaks || [])];
          if (updatedBreaks[breakIdx]) {
            updatedBreaks[breakIdx] = { ...updatedBreaks[breakIdx], [field]: val };
          }
          return { ...s, breaks: updatedBreaks };
        }
        return s;
      })
    );
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

  // Add Time-Off / Vacation
  const handleAddTimeOff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaffId || !newTimeOffFrom || !newTimeOffTo) return;
    try {
      setIsAddingTimeOff(true);
      const fromUtc = new Date(`${newTimeOffFrom}T00:00:00Z`).toISOString();
      const toUtc = new Date(`${newTimeOffTo}T23:59:59Z`).toISOString();

      await api.createStaffTimeOff(
        selectedStaffId,
        {
          from_at_utc: fromUtc,
          to_at_utc: toUtc,
          reason: newTimeOffReason.trim() || 'Отпуск',
        },
        token,
        tenantId
      );
      onShowToast('Период отпуска добавлен');
      setNewTimeOffFrom('');
      setNewTimeOffTo('');
      await loadTimeOff(selectedStaffId);
    } catch (err: any) {
      alert(`Ошибка добавления отпуска: ${err.message || err}`);
    } finally {
      setIsAddingTimeOff(false);
    }
  };

  // Delete Time-Off
  const handleDeleteTimeOff = async (timeOffId: string) => {
    if (!selectedStaffId) return;
    if (!window.confirm('Отменить и удалить данный период отпуска?')) return;
    try {
      await api.deleteStaffTimeOff(selectedStaffId, timeOffId, token, tenantId);
      onShowToast('Период отпуска удален');
      await loadTimeOff(selectedStaffId);
    } catch (err: any) {
      alert(`Ошибка удаления: ${err.message || err}`);
    }
  };

  const dayNames = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top action row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Команда барбершопа</h2>
          <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
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
              borderRadius: '14px',
              border: 'none',
              background: 'var(--brand)',
              color: 'var(--brand-fg)',
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
      <div style={{ background: 'var(--panel)', borderRadius: '22px', border: '1px solid var(--line)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--canvas)', color: 'var(--muted)' }}>
              <th style={{ padding: '12px 16px' }}>Сотрудник</th>
              <th style={{ padding: '12px 16px' }}>Должность</th>
              <th style={{ padding: '12px 16px' }}>Филиалы</th>
              <th style={{ padding: '12px 16px' }}>Онлайн-запись</th>
              <th style={{ padding: '12px 16px' }}>Статус</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)' }}>
                  Загрузка команды…
                </td>
              </tr>
            ) : staffList.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)' }}>
                  Сотрудники не добавлены
                </td>
              </tr>
            ) : (
              staffList.map(s => {
                const assignedBranches = branches.filter(b => (s.branch_ids || []).includes(b.id));
                return (
                  <tr
                    key={s.id}
                    onClick={() => handleOpenStaffModal(s.id)}
                    style={{ borderBottom: '1px solid var(--chip)', cursor: 'pointer', transition: 'background 0.1s ease' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--canvas)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          background: s.color || 'var(--brand)',
                          color: 'var(--brand-fg)',
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
                      <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                        {assignedBranches.length > 0
                          ? assignedBranches.map(b => b.name).join(', ')
                          : 'Все филиалы'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          fontSize: '12px',
                          padding: '2px 8px',
                          borderRadius: '8px',
                          fontWeight: 600,
                          background: s.online_bookable ? 'color-mix(in srgb, var(--pos) 12%, var(--panel))' : 'var(--chip)',
                          color: s.online_bookable ? 'var(--pos)' : 'var(--muted)',
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
                          borderRadius: '8px',
                          fontWeight: 600,
                          background: s.active ? 'color-mix(in srgb, var(--brand) 10%, var(--panel))' : 'color-mix(in srgb, var(--neg) 10%, var(--panel))',
                          color: s.active ? 'var(--brand)' : 'var(--neg)',
                        }}
                      >
                        {s.active ? 'Активен' : 'В архиве'}
                      </span>
                    </td>
                  </tr>
                );
              })
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
              maxWidth: '720px',
              background: 'var(--panel)',
              borderRadius: '22px',
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
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: staffDetail.color || 'var(--brand)',
                    color: 'var(--brand-fg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '15px',
                  }}
                >
                  {staffDetail.display_name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>{staffDetail.display_name}</h3>
                  <div style={{ fontSize: '13px', color: 'var(--muted)' }}>{staffDetail.role_title}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStaffId(null)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--muted)' }}
              >
                ✕
              </button>
            </div>

            {/* Profile Tabs */}
            <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid var(--line)', paddingBottom: '8px', overflowX: 'auto' }}>
              <button
                type="button"
                onClick={() => setProfileTab('profile')}
                style={{
                  padding: '8px 14px',
                  borderRadius: '12px',
                  border: 'none',
                  background: profileTab === 'profile' ? 'color-mix(in srgb, var(--brand) 10%, var(--panel))' : 'transparent',
                  color: profileTab === 'profile' ? 'var(--brand)' : 'var(--muted)',
                  fontWeight: profileTab === 'profile' ? 600 : 500,
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Профиль и филиалы
              </button>
              <button
                type="button"
                onClick={() => setProfileTab('services')}
                style={{
                  padding: '8px 14px',
                  borderRadius: '12px',
                  border: 'none',
                  background: profileTab === 'services' ? 'color-mix(in srgb, var(--brand) 10%, var(--panel))' : 'transparent',
                  color: profileTab === 'services' ? 'var(--brand)' : 'var(--muted)',
                  fontWeight: profileTab === 'services' ? 600 : 500,
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Услуги и цены
              </button>
              <button
                type="button"
                onClick={() => setProfileTab('schedule')}
                style={{
                  padding: '8px 14px',
                  borderRadius: '12px',
                  border: 'none',
                  background: profileTab === 'schedule' ? 'color-mix(in srgb, var(--brand) 10%, var(--panel))' : 'transparent',
                  color: profileTab === 'schedule' ? 'var(--brand)' : 'var(--muted)',
                  fontWeight: profileTab === 'schedule' ? 600 : 500,
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                График и перерывы
              </button>
              <button
                type="button"
                onClick={() => setProfileTab('timeoff')}
                style={{
                  padding: '8px 14px',
                  borderRadius: '12px',
                  border: 'none',
                  background: profileTab === 'timeoff' ? 'color-mix(in srgb, var(--brand) 10%, var(--panel))' : 'transparent',
                  color: profileTab === 'timeoff' ? 'var(--brand)' : 'var(--muted)',
                  fontWeight: profileTab === 'timeoff' ? 600 : 500,
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Отпуск и отгулы ({timeOffList.length})
              </button>
            </div>

            {/* Tab: Profile & Branches */}
            {profileTab === 'profile' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>ФИО специалиста</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      style={{ height: '36px', padding: '0 10px', borderRadius: '12px', border: '1px solid var(--line)', fontSize: '13px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>Должность</label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      style={{ height: '36px', padding: '0 10px', borderRadius: '12px', border: '1px solid var(--line)', fontSize: '13px' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>Цвет в календаре:</label>
                    <input
                      type="color"
                      value={editColor}
                      onChange={e => setEditColor(e.target.value)}
                      style={{ width: '36px', height: '36px', border: 'none', background: 'none', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '13px', color: 'var(--muted)' }}>{editColor}</span>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={editOnlineBookable}
                      onChange={e => setEditOnlineBookable(e.target.checked)}
                    />
                    <span>Разрешить клиентам онлайн-запись</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={editActive}
                      onChange={e => setEditActive(e.target.checked)}
                    />
                    <span>Активен</span>
                  </label>
                </div>

                {/* Branch Assignments */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--chip)', paddingTop: '12px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                    Привязка мастера к филиалам:
                  </label>
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)' }}>
                    Отметьте филиалы, в которых мастер ведёт приём. Для каждого филиала можно настроить независимый график работы.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                    {branches.map(b => {
                      const isAssigned = editBranchIds.includes(b.id);
                      return (
                        <label
                          key={b.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px 12px',
                            borderRadius: '12px',
                            border: `1px solid ${isAssigned ? 'color-mix(in srgb, var(--brand) 40%, var(--panel))' : 'var(--line)'}`,
                            background: isAssigned ? 'color-mix(in srgb, var(--brand) 10%, var(--panel))' : 'var(--panel)',
                            cursor: 'pointer',
                            fontSize: '13px',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isAssigned}
                            onChange={e => {
                              if (e.target.checked) {
                                setEditBranchIds([...editBranchIds, b.id]);
                              } else {
                                setEditBranchIds(editBranchIds.filter(id => id !== b.id));
                              }
                            }}
                          />
                          <div>
                            <b>{b.name}</b> <span style={{ color: 'var(--muted)' }}>({b.city}, {b.address})</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={isSavingProfile}
                  style={{
                    alignSelf: 'flex-end',
                    padding: '8px 20px',
                    borderRadius: '12px',
                    border: 'none',
                    background: 'var(--brand)',
                    color: 'var(--brand-fg)',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {isSavingProfile ? 'Сохранение…' : 'Сохранить профиль'}
                </button>
              </div>
            )}

            {/* Tab: Services & Custom Pricing */}
            {profileTab === 'services' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {branches.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>Филиал:</span>
                    <select
                      value={modalBranchId}
                      onChange={e => {
                        const newBid = e.target.value;
                        setModalBranchId(newBid);
                        if (selectedStaffId) loadBranchSpecificData(selectedStaffId, newBid);
                      }}
                      style={{ padding: '4px 8px', borderRadius: '10px', border: '1px solid var(--line)', fontSize: '13px' }}
                    >
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                  Назначьте услуги и укажите индивидуальную стоимость или длительность (например, у топ-барбера):
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                  {allServices.map(svc => {
                    const off = customOffers[svc.id] || { price: '', duration: '', active: false };
                    return (
                      <div
                        key={svc.id}
                        data-testid={`service-offer-row-${svc.id}`}
                        style={{
                          padding: '10px',
                          border: `1px solid ${off.active ? 'color-mix(in srgb, var(--brand) 40%, var(--panel))' : 'var(--line)'}`,
                          borderRadius: '12px',
                          background: off.active ? 'var(--canvas)' : 'var(--panel)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                        }}
                      >
                        <input
                          type="checkbox"
                          data-testid={`service-checkbox-${svc.id}`}
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
                          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                            Базовая цена: {(svc.base_price_minor / 100).toLocaleString('ru-RU')} ₸ ({svc.base_duration_minutes} мин)
                          </div>
                        </div>
                        {off.active && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontSize: '10px', color: 'var(--muted)' }}>Индивид. цена:</span>
                              <input
                                type="number"
                                data-testid={`service-price-input-${svc.id}`}
                                value={off.price}
                                placeholder={`${svc.base_price_minor / 100} ₸`}
                                onChange={e => {
                                  setCustomOffers({
                                    ...customOffers,
                                    [svc.id]: { ...off, price: e.target.value },
                                  });
                                }}
                                style={{ width: '90px', height: '32px', padding: '0 6px', borderRadius: '10px', border: '1px solid var(--line)', fontSize: '12px' }}
                              />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontSize: '10px', color: 'var(--muted)' }}>Длительность:</span>
                              <input
                                type="number"
                                value={off.duration}
                                placeholder={`${svc.base_duration_minutes} мин`}
                                onChange={e => {
                                  setCustomOffers({
                                    ...customOffers,
                                    [svc.id]: { ...off, duration: e.target.value },
                                  });
                                }}
                                style={{ width: '70px', height: '32px', padding: '0 6px', borderRadius: '10px', border: '1px solid var(--line)', fontSize: '12px' }}
                              />
                            </div>
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
                  style={{ alignSelf: 'flex-end', padding: '8px 20px', borderRadius: '12px', border: 'none', background: 'var(--brand)', color: 'var(--brand-fg)', fontWeight: 600, cursor: 'pointer' }}
                >
                  {isSavingOffers ? 'Сохранение…' : 'Сохранить цены'}
                </button>
              </div>
            )}

            {/* Tab: Weekly Schedule & Breaks */}
            {profileTab === 'schedule' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {branches.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>Филиал:</span>
                    <select
                      value={modalBranchId}
                      onChange={e => {
                        const newBid = e.target.value;
                        setModalBranchId(newBid);
                        if (selectedStaffId) loadBranchSpecificData(selectedStaffId, newBid);
                      }}
                      style={{ padding: '4px 8px', borderRadius: '10px', border: '1px solid var(--line)', fontSize: '13px' }}
                    >
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                  Настройте рабочие часы и обеденные перерывы мастера по дням недели:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '340px', overflowY: 'auto' }}>
                  {scheduleShifts.map((shift, idx) => (
                    <div
                      key={shift.weekday_iso}
                      style={{
                        padding: '12px',
                        border: '1px solid var(--line)',
                        borderRadius: '14px',
                        background: shift.is_working ? 'var(--panel)' : 'var(--canvas)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ width: '120px', fontWeight: 600, fontSize: '14px' }}>
                          {dayNames[shift.weekday_iso - 1]}
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={shift.is_working}
                            onChange={e => {
                              const copy = [...scheduleShifts];
                              copy[idx].is_working = e.target.checked;
                              setScheduleShifts(copy);
                            }}
                          />
                          <span style={{ fontWeight: shift.is_working ? 600 : 400, color: shift.is_working ? 'var(--fg)' : 'var(--muted)' }}>
                            {shift.is_working ? 'Рабочий день' : 'Выходной'}
                          </span>
                        </label>
                        {shift.is_working && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Смена:</span>
                            <input
                              type="time"
                              value={shift.local_start}
                              onChange={e => {
                                const copy = [...scheduleShifts];
                                copy[idx].local_start = e.target.value;
                                setScheduleShifts(copy);
                              }}
                              style={{ height: '30px', borderRadius: '10px', border: '1px solid var(--line)', padding: '0 4px', fontSize: '12px' }}
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
                              style={{ height: '30px', borderRadius: '10px', border: '1px solid var(--line)', padding: '0 4px', fontSize: '12px' }}
                            />
                          </div>
                        )}
                      </div>

                      {/* Breaks row */}
                      {shift.is_working && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '8px', borderLeft: '2px solid var(--line)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>
                              Перерывы и обед:
                            </span>
                            <button
                              type="button"
                              onClick={() => handleAddBreak(shift.weekday_iso)}
                              style={{
                                fontSize: '11px',
                                padding: '2px 8px',
                                borderRadius: '8px',
                                border: '1px solid var(--line)',
                                background: 'var(--panel)',
                                color: 'var(--brand)',
                                cursor: 'pointer',
                                fontWeight: 600,
                              }}
                            >
                              + Перерыв
                            </button>
                          </div>

                          {(shift.breaks || []).length === 0 ? (
                            <span style={{ fontSize: '11px', color: 'var(--muted2)' }}>Без перерывов</span>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                              {(shift.breaks || []).map((brk: any, bIdx: number) => (
                                <div
                                  key={bIdx}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '2px 6px',
                                    background: 'var(--chip)',
                                    borderRadius: '10px',
                                    fontSize: '11px',
                                  }}
                                >
                                  <input
                                    type="time"
                                    value={brk.local_start}
                                    onChange={e => handleBreakChange(shift.weekday_iso, bIdx, 'local_start', e.target.value)}
                                    style={{ height: '24px', borderRadius: '8px', border: '1px solid var(--line)', padding: '0 2px', fontSize: '11px' }}
                                  />
                                  <span>–</span>
                                  <input
                                    type="time"
                                    value={brk.local_end}
                                    onChange={e => handleBreakChange(shift.weekday_iso, bIdx, 'local_end', e.target.value)}
                                    style={{ height: '24px', borderRadius: '8px', border: '1px solid var(--line)', padding: '0 2px', fontSize: '11px' }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveBreak(shift.weekday_iso, bIdx)}
                                    title="Удалить перерыв"
                                    style={{ background: 'none', border: 'none', color: 'var(--neg)', cursor: 'pointer', fontWeight: 700, padding: '0 2px' }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleSaveSchedule}
                  disabled={isSavingSchedule}
                  style={{ alignSelf: 'flex-end', padding: '8px 20px', borderRadius: '12px', border: 'none', background: 'var(--brand2)', color: 'var(--brand-fg)', fontWeight: 600, cursor: 'pointer' }}
                >
                  {isSavingSchedule ? 'Сохранение…' : 'Сохранить график'}
                </button>
              </div>
            )}

            {/* Tab: Vacations & Time Off */}
            {profileTab === 'timeoff' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ background: 'color-mix(in srgb, var(--brand) 10%, var(--panel))', border: '1px solid color-mix(in srgb, var(--brand) 30%, var(--panel))', padding: '12px', borderRadius: '14px', fontSize: '13px', color: 'var(--brand)' }}>
                  ℹ️ В дни отпуска или отгула онлайн-запись к мастеру полностью отключается, а слоты исключаются из публичного календаря.
                </div>

                {/* Form to add time-off */}
                <form
                  onSubmit={handleAddTimeOff}
                  style={{
                    background: 'var(--canvas)',
                    border: '1px solid var(--line)',
                    borderRadius: '18px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <b style={{ fontSize: '14px' }}>Оформить отпуск или отгул</b>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr auto', gap: '10px', alignItems: 'flex-end' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '12px', color: 'var(--muted)' }}>Дата начала:</label>
                      <input
                        type="date"
                        value={newTimeOffFrom}
                        onChange={e => setNewTimeOffFrom(e.target.value)}
                        required
                        style={{ height: '34px', padding: '0 8px', borderRadius: '10px', border: '1px solid var(--line)', fontSize: '12px' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '12px', color: 'var(--muted)' }}>Дата окончания:</label>
                      <input
                        type="date"
                        value={newTimeOffTo}
                        onChange={e => setNewTimeOffTo(e.target.value)}
                        required
                        style={{ height: '34px', padding: '0 8px', borderRadius: '10px', border: '1px solid var(--line)', fontSize: '12px' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '12px', color: 'var(--muted)' }}>Причина / Тип:</label>
                      <input
                        type="text"
                        value={newTimeOffReason}
                        onChange={e => setNewTimeOffReason(e.target.value)}
                        placeholder="Ежегодный отпуск, Больничный"
                        style={{ height: '34px', padding: '0 8px', borderRadius: '10px', border: '1px solid var(--line)', fontSize: '12px' }}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isAddingTimeOff}
                      style={{
                        height: '34px',
                        padding: '0 16px',
                        borderRadius: '10px',
                        border: 'none',
                        background: 'var(--brand)',
                        color: 'var(--brand-fg)',
                        fontWeight: 600,
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      {isAddingTimeOff ? 'Добавление…' : '+ Назначить'}
                    </button>
                  </div>
                </form>

                {/* List of Time-off */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <b style={{ fontSize: '13px', color: 'var(--muted)' }}>Запланированные периоды отсутствия:</b>
                  {isLoadingTimeOff ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                      Загрузка графика отпусков…
                    </div>
                  ) : timeOffList.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted2)', fontSize: '13px', border: '1px dashed var(--line)', borderRadius: '12px' }}>
                      Нет запланированных отпусков
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {timeOffList.map(item => {
                        const fromDate = item.from_at_utc.split('T')[0];
                        const toDate = item.to_at_utc.split('T')[0];
                        return (
                          <div
                            key={item.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '10px 14px',
                              background: 'var(--panel)',
                              border: '1px solid var(--line)',
                              borderRadius: '12px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <span style={{ fontSize: '18px' }}>🏖️</span>
                              <div>
                                <b style={{ fontSize: '14px' }}>{fromDate} — {toDate}</b>
                                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                                  {item.reason || 'Отпуск'}
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteTimeOff(item.id)}
                              style={{
                                padding: '4px 10px',
                                borderRadius: '10px',
                                border: '1px solid color-mix(in srgb, var(--neg) 30%, var(--panel))',
                                background: 'color-mix(in srgb, var(--neg) 10%, var(--panel))',
                                color: 'var(--neg)',
                                fontSize: '12px',
                                cursor: 'pointer',
                                fontWeight: 500,
                              }}
                            >
                              Отменить отпуск
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
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
              maxWidth: '420px',
              background: 'var(--panel)',
              borderRadius: '22px',
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
                style={{ height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Должность</label>
              <input
                type="text"
                value={addTitle}
                onChange={e => setAddTitle(e.target.value)}
                placeholder="Барбер, Топ-барбер"
                style={{ height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
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
                <span style={{ fontSize: '13px', color: 'var(--muted)' }}>{addColor}</span>
              </div>
            </div>
            {branches.length > 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>Основной филиал</label>
                <select
                  value={addBranchId}
                  onChange={e => setAddBranchId(e.target.value)}
                  style={{ height: '38px', padding: '0 8px', borderRadius: '12px', border: '1px solid var(--line)' }}
                >
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{ padding: '8px 16px', borderRadius: '12px', border: '1px solid var(--line)', background: 'var(--panel)', cursor: 'pointer' }}
              >
                Отмена
              </button>
              <button
                type="submit"
                style={{ padding: '8px 16px', borderRadius: '12px', border: 'none', background: 'var(--brand)', color: 'var(--brand-fg)', fontWeight: 600, cursor: 'pointer' }}
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
