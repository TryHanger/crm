import React, { useState, useEffect } from 'react';
import { BusinessCrmApiClient } from '@crm/api-client';
import QRCode from 'qrcode';

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
  const [isPublished, setIsPublished] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [businessName, setBusinessName] = useState('ВАШ БИЗНЕС');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (publicUrl) {
      QRCode.toDataURL(publicUrl, { width: 220, margin: 2, errorCorrectionLevel: 'M' })
        .then(url => setQrCodeDataUrl(url))
        .catch(err => console.error('Failed to generate QR code', err));
    } else {
      setQrCodeDataUrl('');
    }
  }, [publicUrl]);

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
          setIsPublished(res.publication.is_published ?? false);
          setPublicUrl(res.publication.public_url || (res.publication.slug ? `http://${res.publication.slug}.localhost:3000` : ''));
        }
        if ((res as any).tenant_slug) {
          setBusinessName((res as any).tenant_slug.toUpperCase());
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
      const res = await api.toggleBookingPublication(nextState, token, tenantId);
      const actualState = res?.is_published !== undefined ? res.is_published : nextState;
      setIsPublished(actualState);
      if (res?.public_url) {
        setPublicUrl(res.public_url);
      }
      onShowToast(actualState ? 'Онлайн-запись опубликована' : 'Онлайн-запись приостановлена');
    } catch (err: any) {
      alert(`Ошибка публикации: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      onShowToast('Ссылка скопирована в буфер обмена');
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      onShowToast('Не удалось скопировать ссылку');
    }
  };

  const handlePrintQr = () => {
    if (!qrCodeDataUrl) return;
    const printWin = window.open('', '_blank');
    if (!printWin) {
      window.print();
      return;
    }
    printWin.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>QR-код для онлайн-записи - ${businessName}</title>
          <style>
            @media print {
              @page { size: auto; margin: 15mm; }
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 90vh;
              margin: 0;
              background: #F8FAFC;
            }
            .card {
              background: #FFFFFF;
              border: 2px solid #E2E8F0;
              border-radius: 20px;
              padding: 36px 32px;
              max-width: 320px;
              text-align: center;
              box-shadow: 0 4px 16px rgba(0,0,0,0.06);
            }
            .brand {
              font-size: 20px;
              font-weight: 800;
              letter-spacing: 0.04em;
              color: #0F172A;
              margin-bottom: 8px;
              text-transform: uppercase;
            }
            .tagline {
              font-size: 13px;
              color: #64748B;
              margin-bottom: 24px;
              line-height: 1.4;
            }
            .qr-wrap {
              display: inline-block;
              padding: 12px;
              background: #FFFFFF;
              border: 1px solid #E2E8F0;
              border-radius: 12px;
              margin-bottom: 16px;
            }
            .qr-wrap img {
              display: block;
              width: 200px;
              height: 200px;
            }
            .instruction {
              font-size: 13px;
              font-weight: 600;
              color: #334155;
              margin-bottom: 8px;
            }
            .url {
              font-size: 11px;
              color: #2563EB;
              word-break: break-all;
              font-family: monospace;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="brand">${businessName}</div>
            <div class="tagline">Онлайн-запись к специалистам</div>
            <div class="qr-wrap">
              <img src="${qrCodeDataUrl}" alt="QR код онлайн-записи" />
            </div>
            <div class="instruction">Наведите камеру телефона для быстрой записи</div>
            <div class="url">${publicUrl}</div>
          </div>
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `);
    printWin.document.close();
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
                  Живой предпросмотр
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
                  {businessName || 'ВАШ БИЗНЕС'}
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
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Ваша персональная ссылка:</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <input
                    data-testid="booking-public-url-input"
                    type="text"
                    readOnly
                    value={publicUrl}
                    placeholder="https://ваша-компания.book.example.kz"
                    style={{
                      flex: '1 1 240px',
                      height: '40px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: '1px solid #CBD5E1',
                      background: '#F8FAFC',
                      fontSize: '13px',
                      color: '#0F172A',
                      fontFamily: 'monospace',
                    }}
                  />
                  <button
                    type="button"
                    data-testid="booking-copy-url-btn"
                    onClick={handleCopyUrl}
                    disabled={!publicUrl}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 14px',
                      height: '40px',
                      borderRadius: '8px',
                      border: copied ? '1px solid #86EFAC' : '1px solid #CBD5E1',
                      background: copied ? '#F0FDF4' : '#FFFFFF',
                      color: copied ? '#166534' : '#334155',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: publicUrl ? 'pointer' : 'not-allowed',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {copied ? '✓ Скопировано' : '📋 Копировать'}
                  </button>
                  <a
                    data-testid="booking-public-url-link"
                    href={publicUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 16px',
                      height: '40px',
                      borderRadius: '8px',
                      background: publicUrl ? '#2563EB' : '#94A3B8',
                      color: '#FFFFFF',
                      textDecoration: 'none',
                      fontSize: '13px',
                      fontWeight: 600,
                      pointerEvents: publicUrl ? 'auto' : 'none',
                    }}
                  >
                    Открыть ↗
                  </a>
                </div>
                <div style={{ fontSize: '12px', color: '#64748B' }}>
                  {isPublished
                    ? 'Ссылка готова для размещения в соцсетях (Instagram, 2GIS, WhatsApp, Telegram)'
                    : 'Приостановлено: клиенты при переходе увидят уведомление о временной паузе'}
                </div>
              </div>

              {/* Real Scannable QR Code */}
              <div
                style={{
                  padding: '24px',
                  border: '1px solid #E2E8F0',
                  borderRadius: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '14px',
                  textAlign: 'center',
                  background: '#F8FAFC',
                }}
              >
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#0F172A' }}>
                  QR-код для онлайн-записи
                </div>
                {qrCodeDataUrl ? (
                  <div
                    style={{
                      padding: '12px',
                      background: '#FFFFFF',
                      borderRadius: '12px',
                      border: '1px solid #E2E8F0',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                      display: 'inline-block',
                    }}
                  >
                    <img
                      data-testid="booking-qr-code"
                      src={qrCodeDataUrl}
                      alt="QR-код онлайн-записи"
                      style={{
                        width: '200px',
                        height: '200px',
                        display: 'block',
                      }}
                    />
                  </div>
                ) : (
                  <div
                    style={{
                      width: '200px',
                      height: '200px',
                      background: '#FFFFFF',
                      borderRadius: '12px',
                      border: '1px dashed #CBD5E1',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#64748B',
                      fontSize: '13px',
                    }}
                  >
                    Генерация QR-кода...
                  </div>
                )}
                <div style={{ fontSize: '13px', color: '#64748B', maxWidth: '380px', lineHeight: 1.4 }}>
                  Разместите этот QR-код на стойке администратора, рабочих местах мастеров, входной группе или визитках
                </div>
                {qrCodeDataUrl && (
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <a
                      data-testid="booking-qr-download-link"
                      href={qrCodeDataUrl}
                      download="booking-qr.png"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 14px',
                        borderRadius: '6px',
                        border: '1px solid #CBD5E1',
                        background: '#FFFFFF',
                        color: '#1D4ED8',
                        textDecoration: 'none',
                        fontSize: '13px',
                        fontWeight: 600,
                      }}
                    >
                      📥 Скачать PNG
                    </a>
                    <button
                      type="button"
                      data-testid="booking-qr-print-btn"
                      onClick={handlePrintQr}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 14px',
                        borderRadius: '6px',
                        border: '1px solid #CBD5E1',
                        background: '#FFFFFF',
                        color: '#334155',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      🖨️ Печать карточки
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
