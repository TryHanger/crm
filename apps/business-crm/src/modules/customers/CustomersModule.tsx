import React, { useState, useEffect } from 'react';
import { BusinessCrmApiClient, CustomerResponse } from '@crm/api-client';

interface CustomersModuleProps {
  api: BusinessCrmApiClient;
  token: string;
  tenantId: string;
  onShowToast: (msg: string) => void;
  userRole: string;
}

export const CustomersModule: React.FC<CustomersModuleProps> = ({
  api,
  token,
  tenantId,
  onShowToast,
  userRole,
}) => {
  const [customers, setCustomers] = useState<CustomerResponse[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
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

  // Edit Customer Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Fetch customers
  const fetchCustomers = async (search?: string) => {
    try {
      setIsLoading(true);
      const list = await api.getCustomers({ search }, token, tenantId);
      setCustomers(list || []);
    } catch (err: any) {
      console.error('Failed to load customers', err);
      setCustomers([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers(searchQuery);
  }, [searchQuery]);

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
  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim() || !newCustPhone.trim()) return;
    try {
      const res: any = await api.createCustomer(
        {
          full_name: newCustName.trim(),
          phone_e164: newCustPhone.trim(),
          email: newCustEmail.trim() || undefined,
          notes_private: newCustNotes.trim() || undefined,
        },
        token,
        tenantId
      );

      if (res.duplicate_detected) {
        setDuplicateWarning(`Найден существующий клиент с таким номером: ${res.full_name}`);
        setTimeout(() => setDuplicateWarning(null), 5000);
      } else {
        setShowCreateModal(false);
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
    setEditPhone(customerDetail.phone || '');
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
        <div style={{ position: 'relative', width: '320px', maxWidth: '100%' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Поиск по имени или телефону…"
            style={{
              width: '100%',
              height: '40px',
              padding: '0 14px',
              borderRadius: '10px',
              border: '1px solid #CBD5E1',
              fontSize: '14px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {userRole !== 'master' && (
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
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
        <div style={{ padding: '12px 16px', background: '#FEF3C7', color: '#92400E', borderRadius: '10px', fontSize: '14px', border: '1px solid #FCD34D' }}>
          ⚠️ {duplicateWarning}
        </div>
      )}

      {/* Customers Table */}
      <div style={{ background: '#FFFFFF', borderRadius: '16px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', color: '#64748B' }}>
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
                <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#64748B' }}>
                  Загрузка списка клиентов…
                </td>
              </tr>
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#64748B' }}>
                  Клиенты не найдены
                </td>
              </tr>
            ) : (
              customers.map(c => {
                const visits = (c as any).completed_visits ?? c.total_bookings ?? 0;
                const tag = visits > 3 ? 'Постоянный' : visits === 0 ? 'Новый' : 'Клиент';
                const tagBg = tag === 'Постоянный' ? '#EFF6FF' : tag === 'Новый' ? '#DCFCE7' : '#F1F5F9';
                const tagColor = tag === 'Постоянный' ? '#1D4ED8' : tag === 'Новый' ? '#15803D' : '#475569';

                return (
                  <tr
                    key={c.id}
                    onClick={() => handleOpenDetail(c.id)}
                    style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer', transition: 'background 0.1s ease' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 600 }}>{c.full_name}</td>
                    <td style={{ padding: '12px 16px', color: '#334155' }}>{(c as any).phone || c.phone_e164}</td>
                    <td style={{ padding: '12px 16px', color: '#64748B' }}>{c.email || '—'}</td>
                    <td style={{ padding: '12px 16px' }}>{visits} шт.</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, background: tagBg, color: tagColor, padding: '2px 8px', borderRadius: '4px' }}>
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
              background: '#FFFFFF',
              borderRadius: '20px',
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
                onClick={() => {
                  setSelectedCustomerId(null);
                  setCustomerDetail(null);
                }}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {isLoadingDetail || !customerDetail ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#64748B' }}>Загрузка…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 700 }}>
                      {customerDetail.full_name}
                    </h3>
                    <div style={{ fontSize: '14px', color: '#64748B' }}>
                      {customerDetail.phone || customerDetail.phone_e164} · {customerDetail.email || 'без email'}
                    </div>
                  </div>
                  {userRole !== 'master' && (
                    <button
                      type="button"
                      onClick={handleOpenEdit}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '8px',
                        border: '1px solid #CBD5E1',
                        background: '#FFFFFF',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      Редактировать
                    </button>
                  )}
                </div>

                {customerDetail.notes_private && (
                  <div style={{ padding: '12px', background: '#F8FAFC', borderRadius: '10px', fontSize: '13px', color: '#334155' }}>
                    <b>Заметка администратора:</b> {customerDetail.notes_private}
                  </div>
                )}

                {/* Notes List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>Заметки и пожелания</div>
                  {customerDetail.notes && customerDetail.notes.length > 0 ? (
                    customerDetail.notes.map((n: any) => (
                      <div key={n.id} style={{ padding: '8px 12px', background: '#F1F5F9', borderRadius: '8px', fontSize: '13px' }}>
                        <div>{n.note}</div>
                        <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>
                          {new Date(n.created_at).toLocaleDateString('ru-RU')}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: '13px', color: '#94A3B8' }}>Пока нет заметок</div>
                  )}

                  {/* Add note input */}
                  <form onSubmit={handleAddNote} style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                    <input
                      type="text"
                      value={newNoteText}
                      onChange={e => setNewNoteText(e.target.value)}
                      placeholder="Добавить заметку о предпочтениях…"
                      style={{ flex: 1, height: '36px', padding: '0 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px' }}
                    />
                    <button
                      type="submit"
                      disabled={isAddingNote}
                      style={{ padding: '0 12px', borderRadius: '8px', border: 'none', background: '#0F172A', color: '#FFFFFF', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Сохранить
                    </button>
                  </form>
                </div>

                {/* History of Bookings */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #E2E8F0', paddingTop: '16px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>
                    История бронирований ({customerDetail.history?.length || 0})
                  </div>
                  {customerDetail.history && customerDetail.history.length > 0 ? (
                    customerDetail.history.map((h: any) => (
                      <div
                        key={h.id}
                        style={{
                          padding: '10px 12px',
                          border: '1px solid #E2E8F0',
                          borderRadius: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: '13px',
                        }}
                      >
                        <div>
                          <b>{new Date(h.starts_at_utc).toLocaleDateString('ru-RU')}</b> — {h.services.join(', ')}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>{(h.amount_minor / 100).toLocaleString('ru-RU')} ₸</span>
                          <span style={{ fontSize: '11px', background: '#EFF6FF', color: '#1D4ED8', padding: '1px 6px', borderRadius: '4px' }}>
                            {h.status}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: '13px', color: '#94A3B8' }}>История визитов пуста</div>
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
          <form
            onSubmit={handleCreateCustomer}
            style={{
              width: '100%',
              maxWidth: '420px',
              background: '#FFFFFF',
              borderRadius: '20px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Новый клиент</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>ФИО клиента</label>
              <input
                type="text"
                value={newCustName}
                onChange={e => setNewCustName(e.target.value)}
                placeholder="Иван Петров"
                required
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
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
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Email (необязательно)</label>
              <input
                type="email"
                value={newCustEmail}
                onChange={e => setNewCustEmail(e.target.value)}
                placeholder="client@example.kz"
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Заметки</label>
              <textarea
                value={newCustNotes}
                onChange={e => setNewCustNotes(e.target.value)}
                placeholder="Предпочтения, особенности стрижки…"
                rows={3}
                style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFFFFF' }}
              >
                Отмена
              </button>
              <button
                type="submit"
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#2563EB', color: '#FFFFFF', fontWeight: 600 }}
              >
                Сохранить
              </button>
            </div>
          </form>
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
              background: '#FFFFFF',
              borderRadius: '20px',
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
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Телефон</label>
              <input
                type="tel"
                value={editPhone}
                onChange={e => setEditPhone(e.target.value)}
                required
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Email</label>
              <input
                type="email"
                value={editEmail}
                onChange={e => setEditEmail(e.target.value)}
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Заметки</label>
              <textarea
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                rows={3}
                style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFFFFF' }}
              >
                Отмена
              </button>
              <button
                type="submit"
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#2563EB', color: '#FFFFFF', fontWeight: 600 }}
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
