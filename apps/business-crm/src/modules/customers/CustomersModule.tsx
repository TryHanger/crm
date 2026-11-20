import React, { useState, useEffect } from 'react';
import { BusinessCrmApiClient, CustomerResponse } from '@crm/api-client';

interface CustomersModuleProps {
  api: BusinessCrmApiClient;
  token: string;
  tenantId: string;
  onShowToast: (msg: string) => void;
  userRole: string;
  initialCustomerId?: string | null;
  onClearTargetCustomer?: () => void;
}

export const CustomersModule: React.FC<CustomersModuleProps> = ({
  api,
  token,
  tenantId,
  onShowToast,
  userRole,
  initialCustomerId,
  onClearTargetCustomer,
}) => {
  const [customers, setCustomers] = useState<CustomerResponse[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [visitsFilter, setVisitsFilter] = useState<'all' | 'with_visits' | 'no_visits' | 'regular'>('all');
  const [sortBy, setSortBy] = useState<'created_at' | 'full_name' | 'completed_visits'>('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [isLoading, setIsLoading] = useState(false);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(initialCustomerId || null);
  const [customerDetail, setCustomerDetail] = useState<any | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // New Note state
  const [newNoteText, setNewNoteText] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);

  // New Customer Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustEmail, setNewCustEmail] = useState('');
  const [newCustNotes, setNewCustNotes] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [sharedPhonePrompt, setSharedPhonePrompt] = useState<{
    existing_name: string;
    phone: string;
    existing_customer_id?: string;
  } | null>(null);

  // Edit Customer Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Fetch customers
  const fetchCustomers = async (search?: string, filter?: string, sort?: string, sortOrder?: 'asc' | 'desc') => {
    try {
      setIsLoading(true);
      const list = await api.getCustomers(
        {
          search: search !== undefined ? search : searchQuery,
          visits_filter: (filter !== undefined ? filter : visitsFilter) as any,
          sort_by: (sort !== undefined ? sort : sortBy) as any,
          order: sortOrder !== undefined ? sortOrder : order,
        },
        token,
        tenantId
      );
      setCustomers(list || []);
    } catch (err: any) {
      console.error('Failed to load customers', err);
      setCustomers([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers(searchQuery, visitsFilter, sortBy, order);
  }, [searchQuery, visitsFilter, sortBy, order]);

  // Load customer detail card
  const handleOpenDetail = async (id: string) => {
    setSelectedCustomerId(id);
    try {
      setIsLoadingDetail(true);
      const detail = await api.getCustomer(id, token, tenantId);
      setCustomerDetail(detail);
    } catch (err: any) {
      alert(`Ошибка загрузки карточки: ${err.message || err}`);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // Open initial customer if supplied via navigation
  useEffect(() => {
    if (initialCustomerId) {
      handleOpenDetail(initialCustomerId);
    }
  }, [initialCustomerId]);

  const handleCloseDetail = () => {
    setSelectedCustomerId(null);
    setCustomerDetail(null);
    if (onClearTargetCustomer) {
      onClearTargetCustomer();
    }
  };

  // Add note
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId || !newNoteText.trim()) return;
    try {
      setIsAddingNote(true);
      await api.addCustomerNote(selectedCustomerId, newNoteText.trim(), token, tenantId);
      setNewNoteText('');
      onShowToast('Заметка добавлена');
      // reload detail
      const updated = await api.getCustomer(selectedCustomerId, token, tenantId);
      setCustomerDetail(updated);
    } catch (err: any) {
      alert(`Ошибка добавления заметки: ${err.message || err}`);
    } finally {
      setIsAddingNote(false);
    }
  };

  // Create customer
  const handleCreateCustomer = async (e?: React.FormEvent, confirmShared = false) => {
    if (e) e.preventDefault();
    if (!newCustName.trim() || !newCustPhone.trim()) return;
    try {
      const res: any = await api.createCustomer(
        {
          full_name: newCustName.trim(),
          phone_e164: newCustPhone.trim(),
          email: newCustEmail.trim() || undefined,
          notes_private: newCustNotes.trim() || undefined,
          confirm_shared_phone: confirmShared,
        },
        token,
        tenantId
      );

      if (res.shared_phone_warning) {
        setSharedPhonePrompt({
          existing_name: res.existing_name,
          phone: res.phone,
          existing_customer_id: res.existing_customer_id,
        });
        return;
      }

      if (res.duplicate_detected) {
        setDuplicateWarning(`Найден существующий клиент с таким номером: ${res.full_name}`);
        setTimeout(() => setDuplicateWarning(null), 5000);
      } else {
        setShowCreateModal(false);
        setSharedPhonePrompt(null);
        setNewCustName('');
        setNewCustPhone('');
        setNewCustEmail('');
        setNewCustNotes('');
        onShowToast('Клиент успешно добавлен');
        fetchCustomers();
      }
    } catch (err: any) {
      alert(`Ошибка сохранения: ${err.message || err}`);
    }
  };

  // Open edit modal
  const handleOpenEdit = () => {
    if (!customerDetail) return;
    setEditName(customerDetail.full_name || '');
    setEditPhone(customerDetail.phone || customerDetail.phone_e164 || '');
    setEditEmail(customerDetail.email || '');
    setEditNotes(customerDetail.notes_private || '');
    setShowEditModal(true);
  };

  // Save edited customer
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId) return;
    try {
      await api.updateCustomer(
        selectedCustomerId,
        {
          full_name: editName.trim(),
          phone_e164: editPhone.trim(),
          email: editEmail.trim() || undefined,
          notes_private: editNotes.trim() || undefined,
        },
        token,
        tenantId
      );
      setShowEditModal(false);
      onShowToast('Данные клиента обновлены');
      const updated = await api.getCustomer(selectedCustomerId, token, tenantId);
      setCustomerDetail(updated);
      fetchCustomers();
    } catch (err: any) {
      alert(`Ошибка обновления: ${err.message || err}`);
    }
  };

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top action row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', flex: 1 }}>
          <div style={{ position: 'relative', width: '280px', maxWidth: '100%' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск по имени или телефону…"
              style={{
                width: '100%',
                height: '40px',
                padding: '0 14px',
                borderRadius: '14px',
                border: '1px solid var(--line)',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Visits Filter */}
          <select
            value={visitsFilter}
            onChange={e => setVisitsFilter(e.target.value as any)}
            style={{
              height: '40px',
              padding: '0 12px',
              borderRadius: '14px',
              border: '1px solid var(--line)',
              fontSize: '13px',
              background: 'var(--panel)',
              color: 'var(--fg)',
            }}
          >
            <option value="all">Все клиенты</option>
            <option value="with_visits">С визитами (1+)</option>
            <option value="no_visits">Без визитов (0)</option>
            <option value="regular">Постоянные (3+)</option>
          </select>

          {/* Sort Filter */}
          <select
            value={`${sortBy}:${order}`}
            onChange={e => {
              const [s, o] = e.target.value.split(':');
              setSortBy(s as any);
              setOrder(o as any);
            }}
            style={{
              height: '40px',
              padding: '0 12px',
              borderRadius: '14px',
              border: '1px solid var(--line)',
              fontSize: '13px',
              background: 'var(--panel)',
              color: 'var(--fg)',
            }}
          >
            <option value="created_at:desc">Сначала новые (по дате)</option>
            <option value="full_name:asc">По имени (А-Я)</option>
            <option value="completed_visits:desc">По числу визитов (убыв.)</option>
          </select>
        </div>

        {userRole !== 'master' && (
          <button
            type="button"
            onClick={() => {
              setSharedPhonePrompt(null);
              setShowCreateModal(true);
            }}
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
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            + Новый клиент
          </button>
        )}
      </div>

      {duplicateWarning && (
        <div style={{ padding: '12px 16px', background: 'color-mix(in srgb, var(--s-arrived) 14%, var(--panel))', color: 'var(--s-arrived)', borderRadius: '14px', fontSize: '14px', border: '1px solid color-mix(in srgb, var(--s-arrived) 45%, var(--panel))' }}>
          ⚠️ {duplicateWarning}
        </div>
      )}

      {/* Customers Table */}
      <div style={{ background: 'var(--panel)', borderRadius: '22px', border: '1px solid var(--line)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--canvas)', color: 'var(--muted)' }}>
              <th style={{ padding: '12px 16px' }}>Клиент</th>
              <th style={{ padding: '12px 16px' }}>Телефон</th>
              <th style={{ padding: '12px 16px' }}>Email</th>
              <th style={{ padding: '12px 16px' }}>Визиты</th>
              <th style={{ padding: '12px 16px' }}>Статус</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)' }}>
                  Загрузка списка клиентов…
                </td>
              </tr>
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)' }}>
                  Клиенты не найдены
                </td>
              </tr>
            ) : (
              customers.map(c => {
                const visits = (c as any).completed_visits ?? c.total_bookings ?? 0;
                const tag = visits >= 3 ? 'Постоянный' : visits === 0 ? 'Новый' : 'Клиент';
                const tagBg = tag === 'Постоянный' ? 'color-mix(in srgb, var(--brand) 10%, var(--panel))' : tag === 'Новый' ? 'color-mix(in srgb, var(--pos) 12%, var(--panel))' : 'var(--chip)';
                const tagColor = tag === 'Постоянный' ? 'var(--brand)' : tag === 'Новый' ? 'var(--pos)' : 'var(--muted)';

                return (
                  <tr
                    key={c.id}
                    onClick={() => handleOpenDetail(c.id)}
                    style={{ borderBottom: '1px solid var(--chip)', cursor: 'pointer', transition: 'background 0.1s ease' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--canvas)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 600 }}>{c.full_name}</td>
                    <td style={{ padding: '12px 16px', color: 'var(--fg)' }}>{(c as any).phone || c.phone_e164}</td>
                    <td style={{ padding: '12px 16px', color: 'var(--muted)' }}>{c.email || '—'}</td>
                    <td style={{ padding: '12px 16px' }}>{visits} шт.</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, background: tagBg, color: tagColor, padding: '2px 8px', borderRadius: '8px' }}>
                        {tag}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Customer Card Modal */}
      {selectedCustomerId && (
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
              maxWidth: '640px',
              background: 'var(--panel)',
              borderRadius: '22px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 700 }}>Карточка клиента</div>
              <button
                type="button"
                onClick={handleCloseDetail}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {isLoadingDetail || !customerDetail ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>Загрузка…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 700 }}>
                      {customerDetail.full_name}
                    </h3>
                    <div style={{ fontSize: '14px', color: 'var(--muted)' }}>
                      {customerDetail.phone || customerDetail.phone_e164} · {customerDetail.email || 'без email'}
                    </div>
                  </div>
                  {userRole !== 'master' && (
                    <button
                      type="button"
                      onClick={handleOpenEdit}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '12px',
                        border: '1px solid var(--line)',
                        background: 'var(--panel)',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      Редактировать
                    </button>
                  )}
                </div>

                {/* Statistics Summary Bar */}
                {customerDetail.stats && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                    <div style={{ background: 'var(--canvas)', padding: '10px 12px', borderRadius: '14px', textAlign: 'center', border: '1px solid var(--line)' }}>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>Всего записей</div>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--fg)', marginTop: '2px' }}>
                        {customerDetail.stats.total_bookings ?? 0}
                      </div>
                    </div>
                    <div style={{ background: 'color-mix(in srgb, var(--pos) 12%, var(--panel))', padding: '10px 12px', borderRadius: '14px', textAlign: 'center', border: '1px solid color-mix(in srgb, var(--pos) 30%, var(--panel))' }}>
                      <div style={{ fontSize: '11px', color: 'var(--pos)', fontWeight: 600 }}>Завершено</div>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--pos)', marginTop: '2px' }}>
                        {customerDetail.stats.completed_visits ?? 0}
                      </div>
                    </div>
                    <div style={{ background: 'color-mix(in srgb, var(--brand) 10%, var(--panel))', padding: '10px 12px', borderRadius: '14px', textAlign: 'center', border: '1px solid color-mix(in srgb, var(--brand) 30%, var(--panel))' }}>
                      <div style={{ fontSize: '11px', color: 'var(--brand)', fontWeight: 600 }}>Отменено</div>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--brand)', marginTop: '2px' }}>
                        {customerDetail.stats.cancelled_visits ?? 0}
                      </div>
                    </div>
                    <div style={{ background: 'color-mix(in srgb, var(--neg) 10%, var(--panel))', padding: '10px 12px', borderRadius: '14px', textAlign: 'center', border: '1px solid color-mix(in srgb, var(--neg) 30%, var(--panel))' }}>
                      <div style={{ fontSize: '11px', color: 'var(--neg)', fontWeight: 600 }}>Неявки</div>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--neg)', marginTop: '2px' }}>
                        {customerDetail.stats.no_show_visits ?? 0}
                      </div>
                    </div>
                  </div>
                )}

                {customerDetail.notes_private && (
                  <div style={{ padding: '12px', background: 'var(--canvas)', borderRadius: '14px', fontSize: '13px', color: 'var(--fg)' }}>
                    <b>Заметка администратора:</b> {customerDetail.notes_private}
                  </div>
                )}

                {/* Notes List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>Заметки и пожелания</div>
                  {customerDetail.notes && customerDetail.notes.length > 0 ? (
                    customerDetail.notes.map((n: any) => (
                      <div key={n.id} style={{ padding: '8px 12px', background: 'var(--chip)', borderRadius: '12px', fontSize: '13px' }}>
                        <div>{n.note}</div>
                        <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                          {new Date(n.created_at).toLocaleDateString('ru-RU')}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: '13px', color: 'var(--muted2)' }}>Пока нет заметок</div>
                  )}

                  {/* Add note input */}
                  <form onSubmit={handleAddNote} style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                    <input
                      type="text"
                      value={newNoteText}
                      onChange={e => setNewNoteText(e.target.value)}
                      placeholder="Добавить заметку о предпочтениях…"
                      style={{ flex: 1, height: '36px', padding: '0 10px', borderRadius: '12px', border: '1px solid var(--line)', fontSize: '13px' }}
                    />
                    <button
                      type="submit"
                      disabled={isAddingNote}
                      style={{ padding: '0 12px', borderRadius: '12px', border: 'none', background: 'var(--brand2)', color: 'var(--brand-fg)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Сохранить
                    </button>
                  </form>
                </div>

                {/* History of Bookings */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>
                    История бронирований ({customerDetail.history?.length || 0})
                  </div>
                  {customerDetail.history && customerDetail.history.length > 0 ? (
                    customerDetail.history.map((h: any) => (
                      <div
                        key={h.id}
                        style={{
                          padding: '10px 12px',
                          border: '1px solid var(--line)',
                          borderRadius: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: '13px',
                        }}
                      >
                        <div>
                          <div>
                            <b>{new Date(h.starts_at_utc).toLocaleDateString('ru-RU')}</b> — {h.services.join(', ')}
                          </div>
                          {(h.branch_name || h.staff_name) && (
                            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                              {h.branch_name && <span>{h.branch_name}</span>}
                              {h.branch_name && h.staff_name && <span> · </span>}
                              {h.staff_name && <span>Мастер: {h.staff_name}</span>}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>{(h.amount_minor / 100).toLocaleString('ru-RU')} ₸</span>
                          <span style={{ fontSize: '11px', background: 'color-mix(in srgb, var(--brand) 10%, var(--panel))', color: 'var(--brand)', padding: '1px 6px', borderRadius: '8px' }}>
                            {h.status}
                          </span>
                          {h.debt_minor > 0 && h.status === 'completed' && (
                            <span style={{ fontSize: '10px', background: 'color-mix(in srgb, var(--neg) 10%, var(--panel))', color: 'var(--neg)', padding: '1px 6px', borderRadius: '8px', fontWeight: 600 }}>
                              Долг: {(h.debt_minor / 100).toLocaleString('ru-RU')} ₸
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: '13px', color: 'var(--muted2)' }}>История визитов пуста</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Customer Modal */}
      {showCreateModal && (
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
          <div
            style={{
              width: '100%',
              maxWidth: '440px',
              background: 'var(--panel)',
              borderRadius: '22px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Новый клиент</h3>

            {sharedPhonePrompt ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', background: 'color-mix(in srgb, var(--s-arrived) 14%, var(--panel))', padding: '16px', borderRadius: '18px', border: '1px solid color-mix(in srgb, var(--s-arrived) 45%, var(--panel))' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--s-arrived)' }}>
                  ⚠️ Номер {sharedPhonePrompt.phone} уже зарегистрирован!
                </div>
                <div style={{ fontSize: '13px', color: 'var(--s-arrived)', lineHeight: 1.4 }}>
                  В базе уже есть клиент <b>«{sharedPhonePrompt.existing_name}»</b> с таким номером телефона.
                  <br /><br />
                  Если это родственник или общий телефон (семья / коллеги), подтвердите создание <b>отдельного профиля</b>. Двух разных людей нельзя объединять в одну карточку.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                  <button
                    type="button"
                    onClick={() => handleCreateCustomer(undefined, true)}
                    style={{ padding: '10px 14px', borderRadius: '12px', border: 'none', background: 'var(--s-arrived)', color: 'var(--brand-fg)', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
                  >
                    ✓ Создать отдельный профиль «{newCustName}»
                  </button>
                  {sharedPhonePrompt.existing_customer_id && (
                    <button
                      type="button"
                      onClick={() => {
                        const exId = sharedPhonePrompt.existing_customer_id!;
                        setShowCreateModal(false);
                        setSharedPhonePrompt(null);
                        handleOpenDetail(exId);
                      }}
                      style={{ padding: '8px 14px', borderRadius: '12px', border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--fg)', fontWeight: 500, fontSize: '13px', cursor: 'pointer' }}
                    >
                      👤 Открыть профиль «{sharedPhonePrompt.existing_name}»
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSharedPhonePrompt(null)}
                    style={{ padding: '6px 12px', borderRadius: '12px', border: 'none', background: 'transparent', color: 'var(--muted)', fontSize: '12px', cursor: 'pointer' }}
                  >
                    Вернуться к редактированию
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={e => handleCreateCustomer(e, false)}
                style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500 }}>ФИО клиента</label>
                  <input
                    type="text"
                    value={newCustName}
                    onChange={e => setNewCustName(e.target.value)}
                    placeholder="Иван Петров"
                    required
                    style={{ height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500 }}>Телефон</label>
                  <input
                    type="tel"
                    value={newCustPhone}
                    onChange={e => setNewCustPhone(e.target.value)}
                    placeholder="+7 (701) 000-00-00"
                    required
                    style={{ height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500 }}>Email (необязательно)</label>
                  <input
                    type="email"
                    value={newCustEmail}
                    onChange={e => setNewCustEmail(e.target.value)}
                    placeholder="client@example.kz"
                    style={{ height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500 }}>Заметки</label>
                  <textarea
                    value={newCustNotes}
                    onChange={e => setNewCustNotes(e.target.value)}
                    placeholder="Предпочтения, особенности стрижки…"
                    rows={3}
                    style={{ padding: '8px 12px', borderRadius: '12px', border: '1px solid var(--line)', fontSize: '13px' }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    style={{ padding: '8px 16px', borderRadius: '12px', border: '1px solid var(--line)', background: 'var(--panel)' }}
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    style={{ padding: '8px 16px', borderRadius: '12px', border: 'none', background: 'var(--brand)', color: 'var(--brand-fg)', fontWeight: 600 }}
                  >
                    Сохранить
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Edit Customer Modal */}
      {showEditModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.4)',
            zIndex: 120,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <form
            onSubmit={handleSaveEdit}
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
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Редактирование клиента</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>ФИО</label>
              <input
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                required
                style={{ height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Телефон</label>
              <input
                type="tel"
                value={editPhone}
                onChange={e => setEditPhone(e.target.value)}
                required
                style={{ height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Email</label>
              <input
                type="email"
                value={editEmail}
                onChange={e => setEditEmail(e.target.value)}
                style={{ height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Заметки</label>
              <textarea
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                rows={3}
                style={{ padding: '8px 12px', borderRadius: '12px', border: '1px solid var(--line)', fontSize: '13px' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                style={{ padding: '8px 16px', borderRadius: '12px', border: '1px solid var(--line)', background: 'var(--panel)' }}
              >
                Отмена
              </button>
              <button
                type="submit"
                style={{ padding: '8px 16px', borderRadius: '12px', border: 'none', background: 'var(--brand)', color: 'var(--brand-fg)', fontWeight: 600 }}
              >
                Сохранить
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
