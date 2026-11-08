import { test, expect } from '@playwright/test';

test.describe('SaaS Booking Web & CRM Integration', () => {

  test('Desktop Booking Flow - Barber House', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // 1. Visit Barber House booking site
    await page.goto('http://barberhouse.localhost:3000');

    // Verify brand title and branch
    await expect(page.locator('header')).toContainText(/barber house/i);
    await expect(page.locator('header')).toContainText(/астана/i);
    await expect(page.locator('h1')).toContainText('Выберите услуги');

    // Screenshot Step 1 initial
    await page.screenshot({ path: 'docs/screenshots/01-desktop-services-step.png', fullPage: true });

    // 2. Select a service
    const firstServiceBtn = page.locator('button[aria-pressed]').first();
    await firstServiceBtn.click();
    await expect(firstServiceBtn).toHaveAttribute('aria-pressed', 'true');

    // Screenshot Step 1 with service selected
    await page.screenshot({ path: 'docs/screenshots/02-desktop-service-selected.png', fullPage: true });

    // 3. Move to Staff Step
    await page.locator('button:has-text("Выбрать специалиста")').click();

    await expect(page.locator('h1')).toContainText('Выберите специалиста');
    await page.screenshot({ path: 'docs/screenshots/03-desktop-staff-step.png', fullPage: true });

    // Select "Any master"
    await page.locator('button:has-text("Любой свободный мастер")').click();

    // 4. Move to DateTime Step
    await page.locator('button:has-text("Выбрать дату и время")').click();
    await expect(page.locator('h1')).toContainText('Выберите дату и время');

    // Select date
    const dateBtn = page.locator('button:has-text("Завтра"), button:has-text("вт"), button:has-text("ср"), button:has-text("чт")').first();
    await dateBtn.click();

    // Wait for slot buttons to load and click first slot button containing ":"
    const slotBtn = page.locator('div:has-text("Свободные слоты") button:has-text(":")').first();
    await slotBtn.waitFor({ state: 'visible', timeout: 10000 });
    await slotBtn.click();

    await page.screenshot({ path: 'docs/screenshots/04-desktop-datetime-step.png', fullPage: true });

    // 5. Move to Confirm Step
    await page.locator('button:has-text("Указать контакты")').click();
    await expect(page.locator('h1')).toContainText('Контактные данные');

    // Fill contact details
    await page.fill('input[placeholder="Иван Петров"]', 'Карим Сериков');
    await page.fill('input[placeholder="+7 (701) 000-00-00"]', '+7 (701) 555-44-33');
    await page.fill('textarea[placeholder*="Особые пожелания"]', 'Первый визит, стрижка ножницами');

    await page.screenshot({ path: 'docs/screenshots/05-desktop-confirm-form.png', fullPage: true });

    // 6. Submit booking
    const submitBtn = page.locator('button:has-text("Подтвердить запись")');
    await submitBtn.click();

    // Verify confirmation result
    await expect(page.locator('h1')).toContainText('Запись подтверждена!', { timeout: 15000 });
    await expect(page.locator('text=Карим Сериков')).toBeVisible();

    await page.screenshot({ path: 'docs/screenshots/06-desktop-booking-confirmed.png', fullPage: true });
  });

  test('Mobile Booking Flow - Modern Cut', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // 1. Visit Modern Cut booking site
    await page.goto('http://moderncut.localhost:3000');

    await expect(page.locator('header')).toContainText(/modern cut/i);
    await page.screenshot({ path: 'docs/screenshots/07-mobile-services-step.png' });

    // Select service
    const firstServiceBtn = page.locator('button[aria-pressed]').first();
    await firstServiceBtn.click();

    // Advance to Staff step
    await page.locator('button:has-text("Выбрать специалиста")').click();
    await expect(page.locator('h1')).toContainText('Выберите специалиста');
    await page.screenshot({ path: 'docs/screenshots/08-mobile-staff-step.png' });

    // Select Any Master
    await page.locator('button:has-text("Любой свободный мастер")').click();
    await page.locator('button:has-text("Выбрать дату и время")').click();

    // DateTime step
    await expect(page.locator('h1')).toContainText('Выберите дату и время');

    // Select date
    const dateBtn = page.locator('button:has-text("Завтра"), button:has-text("вт"), button:has-text("ср")').first();
    await dateBtn.click();

    const slotBtn = page.locator('div:has-text("Свободные слоты") button:has-text(":")').first();
    await slotBtn.waitFor({ state: 'visible', timeout: 10000 });
    await slotBtn.click();
    await page.screenshot({ path: 'docs/screenshots/09-mobile-datetime-step.png' });

    // Advance to Confirm step
    await page.locator('button:has-text("Указать контакты")').click();
    await expect(page.locator('h1')).toContainText('Контактные данные');

    await page.fill('input[placeholder="Иван Петров"]', 'Данияр Ахметов');
    await page.fill('input[placeholder="+7 (701) 000-00-00"]', '+7 (777) 123-45-67');
    await page.screenshot({ path: 'docs/screenshots/10-mobile-confirm-step.png' });

    // Submit
    await page.locator('button:has-text("Подтвердить запись")').click();
    await expect(page.locator('h1')).toContainText('Запись подтверждена!', { timeout: 15000 });
    await page.screenshot({ path: 'docs/screenshots/11-mobile-booking-confirmed.png' });
  });

  test('Cross-App Vertical Slice: CRM Login, Calendar Verification, PATCH Status & Tenant Isolation', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // 1. Visit CRM Login
    await page.goto('http://localhost:3001');

    // Login screen should be displayed
    await expect(page.locator('h1')).toContainText('Вход в CRM');

    // Fill Barber House owner credentials
    await page.fill('input[type="email"]', 'owner@barberhouse.kz');
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button[type="submit"]');

    // Wait for calendar to load
    await expect(page.locator('h1')).toContainText('Календарь записей', { timeout: 15000 });
    await expect(page.locator('header')).toContainText(/barber house/i);

    // Screenshot Barber House CRM
    await page.screenshot({ path: 'docs/screenshots/12-crm-calendar-barberhouse.png', fullPage: true });

    // Find and click any appointment card in Barber House calendar
    const bookingCard = page.locator('[style*="border-left"]').first();
    if (await bookingCard.isVisible()) {
      await bookingCard.click();

      // Modal opens
      await expect(page.locator('text=Детали записи')).toBeVisible();

      // Click "Клиент прибыл" (fires PATCH status)
      const arrivedBtn = page.locator('button:has-text("Клиент прибыл")');
      if (await arrivedBtn.isVisible()) {
        await arrivedBtn.click();
        // Toast confirms status update
        await expect(page.locator('text=Статус записи обновлен')).toBeVisible({ timeout: 5000 });
      }
    }

    // 2. Logout from Barber House
    await page.click('button:has-text("Выйти")');
    await expect(page.locator('h1')).toContainText('Вход в CRM');

    // 3. Login as Modern Cut owner
    await page.fill('input[type="email"]', 'owner@moderncut.kz');
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button[type="submit"]');

    // Wait for Modern Cut calendar to load
    await expect(page.locator('h1')).toContainText('Календарь записей', { timeout: 15000 });
    await expect(page.locator('header')).toContainText(/modern cut/i);

    // Modern Cut calendar must NOT show Barber House customer
    await expect(page.locator('text=Карим Сериков')).not.toBeVisible();

    // Screenshot Modern Cut CRM
    await page.screenshot({ path: 'docs/screenshots/13-crm-calendar-moderncut.png', fullPage: true });
  });

  test('Three Entry Flows (service-first, master-first, time-first) & Navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('http://barberhouse.localhost:3000');

    // Verify all 3 tab buttons are visible in header
    await expect(page.locator('button:has-text("По услуге")')).toBeVisible();
    await expect(page.locator('button:has-text("По мастеру")')).toBeVisible();
    await expect(page.locator('button:has-text("По времени")')).toBeVisible();

    // 1. Switch to "По мастеру" flow
    await page.locator('button:has-text("По мастеру")').click();
    await expect(page.locator('h1')).toContainText('Выберите специалиста');

    // 2. Switch to "По времени" flow
    await page.locator('button:has-text("По времени")').click();
    await expect(page.locator('h1')).toContainText('Выберите дату и время');

    // 3. Switch back to "По услуге" flow
    await page.locator('button:has-text("По услуге")').click();
    await expect(page.locator('h1')).toContainText('Выберите услуги');
  });

  test('Multi-Viewport Layout Integrity (320px, 360px, 390px, 1280px)', async ({ page }) => {
    const viewports = [
      { width: 320, height: 600 },
      { width: 360, height: 740 },
      { width: 390, height: 844 },
      { width: 1280, height: 800 }
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto('http://barberhouse.localhost:3000');
      await expect(page.locator('header')).toBeVisible();
      await expect(page.locator('h1')).toBeVisible();

      // Check horizontal overflow: scrollWidth should equal or be close to clientWidth
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasHorizontalScroll).toBe(false);
    }
  });

});
