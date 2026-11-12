import React, { useState, useEffect, useCallback } from 'react';

export interface ThemeColors {
  bg: string;
  card: string;
  tile: string;
  accent: string;
  muted: string;
  hair: string;
  ink: string;
  on: string;
  mode: 'light' | 'dark';
}

const NEUTRAL_THEME: ThemeColors = {
  bg: '#F7F7F5',
  card: '#FFFFFF',
  tile: '#F0F0EE',
  accent: '#242424',
  muted: '#646464',
  hair: '#D9D9D5',
  ink: '#202124',
  on: '#FFFFFF',
  mode: 'light',
};

const KEY = 'crm-style-neutral-v1';

function enc(x: number) {
  x = Math.min(1, Math.max(0, x));
  return Math.round((x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255);
}

function hex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map(v => {
    const n = enc(v).toString(16);
    return n.length < 2 ? '0' + n : n;
  }).join('');
}

function ok2hex(L: number, C: number, H: number): string {
  const h = (H * Math.PI) / 180;
  let r = 0, g = 0, bl = 0;
  let chroma = C;
  for (let k = 0; k < 80; k++) {
    const a = chroma * Math.cos(h);
    const b = chroma * Math.sin(h);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    if ((r >= -0.001 && r <= 1.001 && g >= -0.001 && g <= 1.001 && bl >= -0.001 && bl <= 1.001) || chroma <= 0) break;
    chroma = Math.max(0, chroma - 0.004);
  }
  return hex(r, g, bl);
}

function lum(h: string): number {
  if (!h || typeof h !== 'string') return 0.5;
  let clean = h.replace(/^#/, '');
  if (clean.length === 3) clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
  const v = [0, 2, 4].map(i => {
    const c = parseInt(clean.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

function cr(a: string, b: string): number {
  const x = lum(a), y = lum(b), hi = Math.max(x, y), lo = Math.min(x, y);
  return (hi + 0.05) / (lo + 0.05);
}

function hexToHsl(hStr: string): [number, number, number] {
  let c = (hStr || '').replace(/^#/, '');
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  const num = parseInt(c, 16);
  if (isNaN(num)) return [200, 0, 0.5];
  const r = ((num >> 16) & 255) / 255, g = ((num >> 8) & 255) / 255, b = (num & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [Math.round(h), s, l];
}

function deriveHarmony(h: number, hexVal: string, harm: string, mode: 'light' | 'dark'): ThemeColors {
  const accent = hexVal || ok2hex(0.48, 0.14, h);
  let hTile = h, hBg = h, hMuted = h;
  if (harm === 'analogous') {
    hTile = (h + 30) % 360; hBg = (h + 15) % 360; hMuted = (h + 30) % 360;
  } else if (harm === 'complementary') {
    hTile = (h + 180) % 360; hBg = (h + 180) % 360; hMuted = (h + 180) % 360;
  } else if (harm === 'triad') {
    hTile = (h + 120) % 360; hBg = (h + 240) % 360; hMuted = (h + 120) % 360;
  }

  const bg = ok2hex(0.974, 0.007, hBg);
  const tile = ok2hex(0.952, 0.014, hTile);
  const hair = ok2hex(0.895, 0.016, hTile);
  const muted = ok2hex(0.48, 0.03, hMuted);
  const on = cr(accent, '#FFFFFF') >= 3.5 ? '#FFFFFF' : '#202124';

  return {
    bg,
    card: '#FFFFFF',
    tile,
    accent,
    muted,
    hair,
    ink: '#202124',
    on,
    mode: mode || 'light',
  };
}

export const ThemeCustomizer: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isCustom, setIsCustom] = useState(false);
  const [hexVal, setHexVal] = useState('#242424');
  const [hue, setHue] = useState(200);
  const [harmony, setHarmony] = useState<'mono' | 'analogous' | 'complementary' | 'triad'>('mono');
  const [roundness, setRoundness] = useState<'S' | 'M' | 'L'>('M');
  const [imported, setImported] = useState<ThemeColors | null>(null);
  const [importInput, setImportInput] = useState('');
  const [importStatus, setImportStatus] = useState<{ msg: string; ok: boolean } | null>(null);

  // Apply colors to document root
  const applyTheme = useCallback((theme: ThemeColors, r: 'S' | 'M' | 'L') => {
    const root = document.documentElement;
    root.style.setProperty('--bg', theme.bg);
    root.style.setProperty('--card', theme.card);
    root.style.setProperty('--tile', theme.tile);
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--muted', theme.muted);
    root.style.setProperty('--hair', theme.hair);
    root.style.setProperty('--ink', theme.ink);
    root.style.setProperty('--on-accent', theme.on);

    const rVal = r === 'S' ? '14px' : r === 'L' ? '28px' : '20px';
    root.style.setProperty('--r', rVal);

    document.body.style.background = `linear-gradient(180deg, ${theme.bg} 0%, color-mix(in oklch, ${theme.bg} 72%, ${theme.hair}) 100%) fixed`;
    document.body.style.color = theme.ink;
  }, []);

  // Compute active theme
  const currentTheme = isCustom
    ? (imported || deriveHarmony(hue, hexVal, harmony, 'light'))
    : NEUTRAL_THEME;

  // On mount: load saved theme from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && typeof saved === 'object') {
        if (saved.isCustom) setIsCustom(true);
        if (saved.hexVal) setHexVal(saved.hexVal);
        if (saved.hue !== undefined) setHue(saved.hue);
        if (saved.harmony) setHarmony(saved.harmony);
        if (saved.roundness) setRoundness(saved.roundness);
        if (saved.imported) setImported(saved.imported);
      }
    } catch {}
  }, []);

  // Whenever state changes: apply and persist
  useEffect(() => {
    applyTheme(currentTheme, roundness);
    try {
      localStorage.setItem(KEY, JSON.stringify({
        isCustom,
        hexVal,
        hue,
        harmony,
        roundness,
        imported,
      }));
    } catch {}
  }, [isCustom, hexVal, hue, harmony, roundness, imported, applyTheme, currentTheme]);

  const handleReset = () => {
    setIsCustom(false);
    setImported(null);
    setHexVal('#242424');
    setHue(200);
    setHarmony('mono');
    setImportStatus(null);
  };

  const handleColorChange = (newHex: string) => {
    setIsCustom(true);
    setImported(null);
    setHexVal(newHex);
    setHue(hexToHsl(newHex)[0]);
  };

  const handleHueChange = (newHue: number) => {
    setIsCustom(true);
    setImported(null);
    setHue(newHue);
    setHexVal(ok2hex(0.48, 0.14, newHue));
  };

  const handleImport = () => {
    if (!importInput.trim()) return;
    const raw = importInput.trim();

    // 1. Realtime Colors URL
    const rtc = raw.match(/colors=([0-9a-fA-F]{3,6}(?:-[0-9a-fA-F]{3,6})+)/i);
    if (rtc) {
      const p = rtc[1].split('-');
      if (p.length >= 3) {
        const norm = (s: string) => '#' + (s.length === 3 ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2] : s);
        const ink = norm(p[0]);
        const bg = norm(p[1]);
        const accent = norm(p[2]);
        const tile = p.length > 3 ? norm(p[3]) : bg;
        const parsed: ThemeColors = {
          bg, card: '#FFFFFF', tile, accent,
          muted: cr(ink, '#FFFFFF') > 6 ? '#646464' : ink,
          hair: tile, ink,
          on: cr(accent, '#FFFFFF') >= 3.5 ? '#FFFFFF' : '#202124',
          mode: lum(bg) < 0.2 ? 'dark' : 'light',
        };
        setIsCustom(true);
        setImported(parsed);
        setHexVal(accent);
        setHue(hexToHsl(accent)[0]);
        setImportStatus({ msg: '✓ Палитра Realtime Colors успешно применена', ok: true });
        return;
      }
    }

    // 2. CSS variables
    if (raw.indexOf('--') !== -1) {
      const gv = (name: string) => {
        const m = raw.match(new RegExp(name + '\\s*:\\s*(#[0-9a-fA-F]{3,6})', 'i'));
        return m ? m[1] : null;
      };
      const a = gv('--accent') || gv('--primary');
      const b = gv('--bg') || gv('--background');
      const k = gv('--text') || gv('--ink');
      const tl = gv('--secondary') || gv('--tile');
      if (a || b) {
        const acc = a || '#242424';
        const bg = b || '#F7F7F5';
        const ink = k || '#202124';
        const parsed: ThemeColors = {
          bg, card: '#FFFFFF', tile: tl || '#F0F0EE', accent: acc,
          muted: '#646464', hair: '#D9D9D5', ink,
          on: cr(acc, '#FFFFFF') >= 3.5 ? '#FFFFFF' : '#202124',
          mode: lum(bg) < 0.2 ? 'dark' : 'light',
        };
        setIsCustom(true);
        setImported(parsed);
        setHexVal(acc);
        setHue(hexToHsl(acc)[0]);
        setImportStatus({ msg: '✓ CSS переменные успешно применены', ok: true });
        return;
      }
    }

    // 3. HEX list / Adobe Color
    const hxs = raw.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/g);
    if (hxs && hxs.length > 0) {
      const acc = hxs[0];
      if (hxs.length === 1) {
        handleColorChange(acc);
        setImportStatus({ msg: `✓ Акцент ${acc} применен`, ok: true });
        return;
      }
      const parsed: ThemeColors = {
        bg: hxs[1] || '#F7F7F5',
        card: '#FFFFFF',
        tile: hxs[2] || '#F0F0EE',
        accent: acc,
        muted: '#646464',
        hair: '#D9D9D5',
        ink: hxs[3] || '#202124',
        on: cr(acc, '#FFFFFF') >= 3.5 ? '#FFFFFF' : '#202124',
        mode: 'light',
      };
      setIsCustom(true);
      setImported(parsed);
      setHexVal(acc);
      setHue(hexToHsl(acc)[0]);
      setImportStatus({ msg: '✓ Палитра цветов успешно применена', ok: true });
      return;
    }

    setImportStatus({ msg: '⚠️ Не удалось распознать ссылку или цвета', ok: false });
  };

  const cleanHex = (h: string) => (h || '').replace('#', '').toLowerCase();
  const rtcUrl = `https://www.realtimecolors.com/?colors=${cleanHex(currentTheme.ink)}-${cleanHex(currentTheme.bg)}-${cleanHex(currentTheme.accent)}-${cleanHex(currentTheme.tile)}-${cleanHex(currentTheme.accent)}&mode=light`;

  return (
    <>
      {/* Decorative SVG Shapes */}
      <svg
        aria-hidden="true"
        style={{
          position: 'fixed',
          zIndex: 0,
          right: '-10%',
          top: '-12%',
          width: 'clamp(520px, 60vw, 1040px)',
          aspectRatio: '800/760',
          pointerEvents: 'none',
          opacity: 0.8,
        }}
        viewBox="0 0 800 760"
      >
        <defs>
          <linearGradient id="gA" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--hair)" stopOpacity="0.8" />
            <stop offset="1" stopColor="var(--hair)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M800 0V760C640 740 520 640 470 500C420 360 330 300 210 270C90 240 20 130 0 0Z" fill="url(#gA)" />
      </svg>

      <svg
        aria-hidden="true"
        style={{
          position: 'fixed',
          zIndex: 0,
          left: '-12%',
          bottom: '-14%',
          width: 'clamp(420px, 48vw, 820px)',
          aspectRatio: '800/760',
          pointerEvents: 'none',
          opacity: 0.8,
        }}
        viewBox="0 0 800 760"
      >
        <defs>
          <linearGradient id="gB" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="var(--hair)" stopOpacity="0.8" />
            <stop offset="1" stopColor="var(--hair)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0 760V180C90 150 200 190 280 280C380 390 380 520 470 600C540 660 660 690 800 760Z" fill="url(#gB)" />
      </svg>

      {/* Floating Action Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Настройка оформления"
        style={{
          position: 'fixed',
          zIndex: 9999,
          right: '20px',
          bottom: '20px',
          height: '46px',
          padding: '0 20px 0 16px',
          borderRadius: '23px',
          background: 'var(--card)',
          color: 'var(--ink)',
          boxShadow: 'var(--sh2, 0 4px 18px rgba(0,0,0,0.14))',
          border: '1px solid var(--hair)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontWeight: 600,
          fontSize: '14px',
          cursor: 'pointer',
          transition: 'transform 0.2s, box-shadow 0.2s',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="8" cy="17" r="2" />
        </svg>
        <span>Оформление</span>
      </button>

      {/* Customizer Drawer */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Настройка оформления сайта"
          style={{
            position: 'fixed',
            zIndex: 10000,
            right: '20px',
            bottom: '76px',
            width: 'min(380px, calc(100vw - 32px))',
            maxHeight: 'min(80vh, 700px)',
            overflowY: 'auto',
            padding: '22px',
            borderRadius: 'var(--r, 20px)',
            background: 'var(--card)',
            color: 'var(--ink)',
            boxShadow: 'var(--sh2, 0 12px 36px rgba(0,0,0,0.22))',
            border: '1px solid var(--hair)',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>
                Оформление сайта
              </div>
              <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '2px' }}>
                Основа — нейтральный стиль. Настраивайте бренд бизнеса.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Закрыть"
              style={{
                width: '32px',
                height: '32px',
                flex: 'none',
                borderRadius: '50%',
                border: '1px solid var(--hair)',
                background: 'var(--tile)',
                color: 'var(--ink)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✕
            </button>
          </div>

          {/* Baseline Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600 }}>Основа дизайна</div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: '12px',
                background: 'var(--tile)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: isCustom ? 'var(--accent)' : 'var(--ink)' }}>
                  {isCustom ? 'Кастомный стиль' : 'Нейтральный (основа)'}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                  {isCustom ? 'Изменён пользователем' : 'Чистый стандарт проекта'}
                </span>
              </div>
              {isCustom && (
                <button
                  type="button"
                  onClick={handleReset}
                  style={{
                    height: '28px',
                    padding: '0 10px',
                    borderRadius: '14px',
                    border: '1px solid var(--hair)',
                    background: 'var(--card)',
                    color: 'var(--ink)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Сброс к основе
                </button>
              )}
            </div>
          </div>

          {/* Color & Hue */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600 }}>Цвет бренда (акцент)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="color"
                value={hexVal.length === 7 ? hexVal : '#242424'}
                onChange={e => handleColorChange(e.target.value)}
                style={{
                  width: '42px',
                  height: '42px',
                  padding: 0,
                  border: 0,
                  borderRadius: '50%',
                  cursor: 'pointer',
                  background: 'transparent',
                }}
              />
              <input
                type="text"
                value={hexVal}
                maxLength={7}
                onChange={e => {
                  let v = e.target.value;
                  setHexVal(v);
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) handleColorChange(v);
                }}
                placeholder="#242424"
                style={{
                  flex: 1,
                  height: '40px',
                  padding: '0 12px',
                  borderRadius: '10px',
                  border: '1px solid var(--hair)',
                  background: 'var(--tile)',
                  color: 'var(--ink)',
                  fontSize: '14px',
                  fontFamily: 'monospace',
                  fontWeight: 600,
                }}
              />
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Цветовой спектр (Hue)</span>
                <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{Math.round(hue)}°</span>
              </div>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={hue}
                onChange={e => handleHueChange(parseFloat(e.target.value))}
                style={{ width: '100%', margin: 0, accentColor: 'var(--accent)' }}
              />
            </label>
          </div>

          {/* Harmonies */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600 }}>Цветовая гармония (Adobe / Realtime)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
              {[
                { k: 'mono', n: 'Монохромная' },
                { k: 'analogous', n: 'Аналоговая' },
                { k: 'complementary', n: 'Комплемент' },
                { k: 'triad', n: 'Триадная' },
              ].map(item => {
                const active = isCustom && harmony === item.k;
                return (
                  <button
                    key={item.k}
                    type="button"
                    onClick={() => {
                      setIsCustom(true);
                      setImported(null);
                      setHarmony(item.k as any);
                    }}
                    style={{
                      height: '36px',
                      borderRadius: '10px',
                      border: active ? '2px solid var(--ink)' : '1px solid var(--hair)',
                      background: active ? 'var(--card)' : 'var(--tile)',
                      color: 'var(--ink)',
                      fontWeight: active ? 700 : 500,
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    {item.n}
                  </button>
                );
              })}
            </div>
          </div>

          {/* External Services Bridge */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600 }}>Связка с Realtime Colors & Adobe</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
              <a
                href={rtcUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  height: '36px',
                  borderRadius: '10px',
                  border: '1px solid var(--hair)',
                  background: 'var(--tile)',
                  color: 'var(--ink)',
                  fontSize: '11px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  textDecoration: 'none',
                }}
              >
                <span>Realtime Colors</span>
                <span>↗</span>
              </a>
              <a
                href="https://color.adobe.com/create/color-wheel"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  height: '36px',
                  borderRadius: '10px',
                  border: '1px solid var(--hair)',
                  background: 'var(--tile)',
                  color: 'var(--ink)',
                  fontSize: '11px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  textDecoration: 'none',
                }}
              >
                <span>Adobe Color</span>
                <span>↗</span>
              </a>
            </div>

            {/* Import Input */}
            <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
              <input
                type="text"
                placeholder="Ссылка Realtime, Adobe или HEX"
                value={importInput}
                onChange={e => setImportInput(e.target.value)}
                style={{
                  flex: 1,
                  height: '36px',
                  padding: '0 10px',
                  borderRadius: '10px',
                  border: '1px solid var(--hair)',
                  background: 'var(--tile)',
                  color: 'var(--ink)',
                  fontSize: '11px',
                }}
              />
              <button
                type="button"
                onClick={handleImport}
                style={{
                  height: '36px',
                  padding: '0 12px',
                  borderRadius: '10px',
                  border: 0,
                  background: 'var(--ink)',
                  color: 'var(--card)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Применить
              </button>
            </div>
            {importStatus && (
              <div style={{ fontSize: '11px', color: importStatus.ok ? 'var(--accent)' : 'var(--err)', marginTop: '2px' }}>
                {importStatus.msg}
              </div>
            )}
          </div>

          {/* Roundness */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600 }}>Скругление карточек</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {(['S', 'M', 'L'] as const).map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setRoundness(opt)}
                  style={{
                    height: '36px',
                    borderRadius: '10px',
                    border: roundness === opt ? '2px solid var(--ink)' : '1px solid var(--hair)',
                    background: roundness === opt ? 'var(--card)' : 'var(--tile)',
                    color: 'var(--ink)',
                    fontWeight: roundness === opt ? 700 : 500,
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  {opt === 'S' ? 'Компакт' : opt === 'M' ? 'Стандарт' : 'Мягко'}
                </button>
              ))}
            </div>
          </div>

          {/* WCAG Badges */}
          <div
            style={{
              paddingTop: '12px',
              borderTop: '1px solid var(--hair)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px 14px',
              fontSize: '11px',
              color: 'var(--muted)',
            }}
          >
            <span>Акцент: <code style={{ color: 'var(--ink)' }}>{currentTheme.accent}</code></span>
            <span>Кнопка: <b style={{ color: 'var(--ink)' }}>{cr(currentTheme.on, currentTheme.accent).toFixed(1)}:1 ✓</b></span>
            <span>Текст: <b style={{ color: 'var(--ink)' }}>{cr(currentTheme.ink, currentTheme.card).toFixed(1)}:1 ✓</b></span>
          </div>
        </div>
      )}
    </>
  );
};
