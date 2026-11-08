import React, { useState, useEffect } from 'react';
import { BusinessCrmApiClient } from '@crm/api-client';

interface OnlineBookingModuleProps {
  api: BusinessCrmApiClient;
  token: string;
  tenantId: string;
  onShowToast: (msg: string) => void;
  userRole: string;
}

export const OnlineBookingModule: React.FC<OnlineBookingModuleProps> = ({
  api,
  token,
  tenantId,
  onShowToast,
  userRole,
}) => {
  const [activeTab, setActiveTab] = useState<'rules' | 'appearance' | 'publish'>('rules');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Policy state
  const [bookAheadDays, setBookAheadDays] = useState(30);
  const [minAdvanceMinutes, setMinAdvanceMinutes] = useState(120);
  const [cutoffMinutes, setCutoffMinutes] = useState(180);
  const [slotStep, setSlotStep] = useState(15);
  const [maxServices, setMaxServices] = useState(5);
  const [allowReschedule, setAllowReschedule] = useState(true);

  // Theme state
  const [primaryColor, setPrimaryColor] = useState('#1E293B');
  const [accentColor, setAccentColor] = useState('#2563EB');

  // Publication state
  const [isPublished, setIsPublished] = useState(true);
  const [publicUrl, setPublicUrl] = useState('http://barberhouse.localhost:3000');

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setIsLoading(true);
        const res = await api.getBookingSettings(token, tenantId);
        if (res.policy) {
          setBookAheadDays(res.policy.book_ahead_days || 30);
          setMinAdvanceMinutes(res.policy.min_advance_minutes || 120);
          setCutoffMinutes(res.policy.cancellation_cutoff_minutes || 180);
          setSlotStep(res.policy.slot_step_minutes || 15);
          setMaxServices(res.policy.max_services_per_booking || 5);
          setAllowReschedule(res.policy.allow_self_reschedule ?? true);
        }
        if (res.theme) {
          setPrimaryColor(res.theme.primary_color || '#1E293B');
          setAccentColor(res.theme.accent_color || '#2563EB');
        }
        if (res.publication) {
          setIsPublished(res.publication.is_published ?? true);
          setPublicUrl(res.publication.public_url || `http://${res.publication.slug}.localhost:3000`);
        }
      } catch (err: any) {
        console.error('Failed to load booking settings', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, [api, token, tenantId]);

  // Save Policy
  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      await api.updateBookingPolicy(
        {
          book_ahead_days: bookAheadDays,
          min_advance_minutes: minAdvanceMinutes,
          cancellation_cutoff_minutes: cutoffMinutes,
          slot_step_minutes: slotStep,
          max_services_per_booking: maxServices,
          allow_self_reschedule: allowReschedule,
        },
        token,
        tenantId
      );
      onShowToast('Правила онлайн-записи сохранены');
    } catch (err: any) {
      alert(`Ошибка сохранения: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Save Theme
  const handleSaveTheme = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      await api.updateBookingTheme(
        { primary_color: primaryColor, accent_color: accentColor },
        token,
        tenantId
      );
      onShowToast('Цветовая схема обновлена');
    } catch (err: any) {
      alert(`Ошибка сохранения темы: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Toggle Publication
  const handleTogglePublication = async () => {
    try {
      setIsSaving(true);
      const nextState = !isPublished;
      await api.toggleBookingPublication(nextState, token, tenantId);
      setIsPublished(nextState);
      onShowToast(nextState ? 'Онлайн-запись опубликована' : 'Онлайн-запись приостановлена');
    } catch (err: any) {
      alert(`Ошибка публикации: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Tabs Bar */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #E2E8F0', paddingBottom: '8px' }}>
        <button
          type="button"
          onClick={() => setActiveTab('rules')}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            border: 'none',
            background: activeTab === 'rules' ? '#EFF6FF' : 'transparent',
            color: activeTab === 'rules' ? '#1D4ED8' : '#64748B',
            fontWeight: activeTab === 'rules' ? 600 : 500,
            cursor: 'pointer',
          }}
        >
          Правила записи
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('appearance')}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            border: 'none',
            background: activeTab === 'appearance' ? '#EFF6FF' : 'transparent',
            color: activeTab === 'appearance' ? '#1D4ED8' : '#64748B',
            fontWeight: activeTab === 'appearance' ? 600 : 500,
            cursor: 'pointer',
          }}
        >
          Внешний вид и предпросмотр
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('publish')}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            border: 'none',
            background: activeTab === 'publish' ? '#EFF6FF' : 'transparent',
            color: activeTab === 'publish' ? '#1D4ED8' : '#64748B',
            fontWeight: activeTab === 'publish' ? 600 : 500,
            cursor: 'pointer',
          }}
        >
          Публикация и QR-код
        </button>
      </div>

      {isLoading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#64748B' }}>Загрузка настроек…</div>
      ) : (
        <>
          {/* Tab 1: Rules */}
          {activeTab === 'rules' && (
            <form
              onSubmit={handleSavePolicy}
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
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Правила бронирования клиентами</h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>
                  Глубина записи вперед (дней)
                </label>
                <input
                  type="number"
                  value={bookAheadDays}
                  onChange={e => setBookAheadDays(parseInt(e.target.value, 10))}
                  min={1}
                  max={90}
                  style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                />
                <span style={{ fontSize: '11px', color: '#64748B' }}>На сколько дней вперед открыты свободные слоты</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>
                  Минимальное время до начала визита (минут)
                </label>
                <input
                  type="number"
                  value={minAdvanceMinutes}
                  onChange={e => setMinAdvanceMinutes(parseInt(e.target.value, 10))}
                  min={0}
                  style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                />
                <span style={{ fontSize: '11px', color: '#64748B' }}>Клиент не может записаться менее чем за это время</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>
                  Время бесплатной отмены клиентом (минут до визита)
                </label>
                <input
                  type="number"
                  value={cutoffMinutes}
                  onChange={e => setCutoffMinutes(parseInt(e.target.value, 10))}
                  min={0}
                  style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>Шаг сетки слотов</label>
                <select
                  value={slotStep}
                  onChange={e => setSlotStep(parseInt(e.target.value, 10))}
                  style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                >
                  <option value={15}>15 минут</option>
                  <option value={30}>30 минут</option>
                  <option value={60}>60 минут</option>
                </select>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer', marginTop: '4px' }}>
                <input
                  type="checkbox"
                  checked={allowReschedule}
                  onChange={e => setAllowReschedule(e.target.checked)}
                />
                <span>Разрешить клиентам самостоятельный перенос записи по ссылке</span>
              </label>

              {userRole !== 'master' && (
                <button
                  type="submit"
                  disabled={isSaving}
                  style={{
                    marginTop: '8px',
                    height: '42px',
                    borderRadius: '10px',
                    border: 'none',
                    background: '#2563EB',
                    color: '#FFFFFF',
                    fontWeight: 600,
                    cursor: isSaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSaving ? 'Сохранение…' : 'Сохранить правила'}
                </button>
              )}
            </form>
          )}

          {/* Tab 2: Appearance & Preview */}
          {activeTab === 'appearance' && (
            <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <form
                onSubmit={handleSaveTheme}
                style={{
                  flex: '1 1 360px',
                  background: '#FFFFFF',
                  borderRadius: '16px',
                  border: '1px solid #E2E8F0',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                }}
              >
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Брендинг виджета</h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500 }}>Основной цвет (Header / Buttons)</label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={e => setPrimaryColor(e.target.value)}
                      style={{ width: '40px', height: '40px', border: 'none', background: 'none', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '13px', color: '#64748B' }}>{primaryColor}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500 }}>Акцентный цвет (Выбор слотов, бейджи)</label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="color"
                      value={accentColor}
                      onChange={e => setAccentColor(e.target.value)}
                      style={{ width: '40px', height: '40px', border: 'none', background: 'none', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '13px', color: '#64748B' }}>{accentColor}</span>
                  </div>
                </div>

                {userRole !== 'master' && (
                  <button
                    type="submit"
                    disabled={isSaving}
                    style={{
                      marginTop: '8px',
                      height: '42px',
                      borderRadius: '10px',
                      border: 'none',
                      background: '#2563EB',
                      color: '#FFFFFF',
                      fontWeight: 600,
                      cursor: isSaving ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isSaving ? 'Сохранение…' : 'Применить цвета'}
                  </button>
                )}
              </form>

              {/* Live Preview Mockup */}
              <div
                style={{
                  width: '320px',
                  border: '1px solid #E2E8F0',
                  borderRadius: '24px',
                  background: '#FFFFFF',
                  padding: '16px',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.06)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', textAlign: 'center' }}>
                  Предпросмотр на мобильном
                </div>
                <div
                  style={{
                    background: primaryColor,
                    color: '#FFFFFF',
                    padding: '12px',
                    borderRadius: '12px',
                    textAlign: 'center',
                    fontWeight: 700,
                    fontSize: '14px',
                  }}
                >
                  BARBER HOUSE
                </div>
                <div style={{ padding: '8px', background: '#F8FAFC', borderRadius: '8px', fontSize: '12px' }}>
                  <b>Мужская стрижка</b> — 7 000 ₸
                </div>
                <button
                  type="button"
                  style={{
                    background: accentColor,
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '10px',
                    fontWeight: 600,
                    fontSize: '13px',
                  }}
                >
                  Выбрать время
                </button>
              </div>
            </div>
          )}

          {/* Tab 3: Publication & QR */}
          {activeTab === 'publish' && (
            <div
              style={{
                maxWidth: '540px',
                background: '#FFFFFF',
                borderRadius: '16px',
                border: '1px solid #E2E8F0',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Публикация страницы онлайн-записи</h3>

              <div
                style={{
                  padding: '16px',
                  background: isPublished ? '#F0FDF4' : '#FEF2F2',
                  border: `1px solid ${isPublished ? '#86EFAC' : '#FCA5A5'}`,
                  borderRadius: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '15px', color: isPublished ? '#166534' : '#991B1B' }}>
                    {isPublished ? '● Онлайн-запись активна' : '○ Онлайн-запись приостановлена'}
                  </div>
                  <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>
                    {isPublished
                      ? 'Клиенты могут свободно записываться по вашей ссылке'
                      : 'Новые записи временно заблокированы'}
                  </div>
                </div>

                {userRole !== 'master' && (
                  <button
                    type="button"
                    onClick={handleTogglePublication}
                    disabled={isSaving}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: 'none',
                      background: isPublished ? '#DC2626' : '#16A34A',
                      color: '#FFFFFF',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: isSaving ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isPublished ? 'Приостановить' : 'Опубликовать'}
                  </button>
                )}
              </div>

              {/* Public Link Card */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>Ваша персональная ссылка:</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    readOnly
                    value={publicUrl}
                    style={{
                      flex: 1,
                      height: '40px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: '1px solid #CBD5E1',
                      background: '#F8FAFC',
                      fontSize: '14px',
                    }}
                  />
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '0 16px',
                      borderRadius: '8px',
                      background: '#2563EB',
                      color: '#FFFFFF',
                      textDecoration: 'none',
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    Открыть
                  </a>
                </div>
              </div>

              {/* QR Code Placeholder */}
              <div
                style={{
                  padding: '20px',
                  border: '1px dashed #CBD5E1',
                  borderRadius: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '10px',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    width: '120px',
                    height: '120px',
                    background: '#0F172A',
                    color: '#FFFFFF',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '14px',
                  }}
                >
                  QR КОД
                </div>
                <div style={{ fontSize: '13px', color: '#64748B' }}>
                  Распечатайте этот QR-код для стойки администратора или визиток
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
