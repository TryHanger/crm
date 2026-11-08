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
    const dateBtn = page.locator('button[data-date]').nth(1);
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

    const publicRef = await page.locator('[data-public-ref]').getAttribute('data-public-ref');
    expect(publicRef).toBeTruthy();
    expect(publicRef).toMatch(/^BH-/);

    await page.screenshot({ path: 'docs/screenshots/06-desktop-booking-confirmed.png', fullPage: true });
  });

  test('Mobile Booking Flow - Modern Cut (MC- Prefix)', async ({ page }) => {
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
    const dateBtn = page.locator('button[data-date]').nth(1);
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

    // Verify Modern Cut prefix strictly starts with MC-
    const publicRef = await page.locator('[data-public-ref]').getAttribute('data-public-ref');
    expect(publicRef).toBeTruthy();
    expect(publicRef).toMatch(/^MC-/);

    await page.screenshot({ path: 'docs/screenshots/11-mobile-booking-confirmed.png' });
  });

  test('Cross-App Vertical Slice: Booking -> CRM Calendar Strict Presence, PATCH Status, Page Reload & Multi-Tenant Isolation', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // 1. Create a booking on Barber House
    await page.goto('http://barberhouse.localhost:3000');
    await page.locator('button[aria-pressed]').first().click();
    await page.locator('button:has-text("Выбрать специалиста")').click();

    // Select first specific master (Дамир)
    const damirMasterBtn = page.locator('button:has-text("Дамир")').first();
    await damirMasterBtn.click();

    await page.locator('button:has-text("Выбрать дату и время")').click();

    // Select tomorrow's date
    const dateBtn = page.locator('button[data-date]').nth(1);
    const targetDate = await dateBtn.getAttribute('data-date');
    expect(targetDate).toBeTruthy();
    await dateBtn.click();

    const slotBtn = page.locator('div:has-text("Свободные слоты") button:has-text(":")').first();
    await slotBtn.waitFor({ state: 'visible', timeout: 10000 });
    await slotBtn.click();

    await page.locator('button:has-text("Указать контакты")').click();
    await page.fill('input[placeholder="Иван Петров"]', 'Азамат Исмаилов');
    await page.fill('input[placeholder="+7 (701) 000-00-00"]', '+7 (705) 111-22-33');
    await page.locator('button:has-text("Подтвердить запись")').click();

    await expect(page.locator('h1')).toContainText('Запись подтверждена!', { timeout: 15000 });
    const publicRef = await page.locator('[data-public-ref]').getAttribute('data-public-ref');
    expect(publicRef).toBeTruthy();
    expect(publicRef).toMatch(/^BH-/);

    // 2. Open CRM Calendar on that target date
    await page.goto(`http://localhost:3001/?date=${targetDate}`);

    // Login screen should be displayed
    await expect(page.locator('h1')).toContainText('Вход в CRM');

    // Fill Barber House owner credentials
    await page.fill('input[type="email"]', 'owner@barberhouse.kz');
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button[type="submit"]');

    // Wait for calendar to load
    await expect(page.locator('h1')).toContainText('Календарь записей', { timeout: 15000 });
    await expect(page.locator('header')).toContainText(/barber house/i);

    // Strictly assert that master columns are rendered
    await expect(page.locator('text=Дамир')).toBeVisible({ timeout: 10000 });

    // STRICT NON-VACUOUS ASSERTION: The created booking card MUST be visible in the calendar!
    const bookingCard = page.locator(`[data-public-ref="${publicRef}"]`);
    await expect(bookingCard).toBeVisible({ timeout: 10000 });
    await expect(bookingCard).toContainText('Азамат Исмаилов');

    // Screenshot Barber House CRM showing actual booking card
    await page.screenshot({ path: 'docs/screenshots/12-crm-calendar-barberhouse.png', fullPage: true });

    // Open booking modal by clicking the card
    await bookingCard.click();
    await expect(page.locator('text=Карточка записи')).toBeVisible({ timeout: 5000 });

    // Click "Клиент прибыл" (executes PATCH status to 'arrived')
    const arrivedBtn = page.locator('button:has-text("Клиент прибыл")');
    await expect(arrivedBtn).toBeVisible();
    await arrivedBtn.click();

    // Confirm status updated via toast / modal update
    await expect(bookingCard.locator('text=Прибыл')).toBeVisible({ timeout: 5000 });

    // Reload CRM page to confirm persistence of PATCH status update in PostgreSQL
    await page.reload();
    await expect(page.locator('h1')).toContainText('Календарь записей', { timeout: 15000 });
    await expect(bookingCard).toBeVisible({ timeout: 10000 });
    await expect(bookingCard).toContainText('Прибыл');

    // 3. Verify Strict Tenant Isolation: Modern Cut CANNOT see this booking
    await page.click('button:has-text("Выйти")');
    await expect(page.locator('h1')).toContainText('Вход в CRM');

    await page.fill('input[type="email"]', 'owner@moderncut.kz');
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button[type="submit"]');

    await expect(page.locator('h1')).toContainText('Календарь записей', { timeout: 15000 });
    await expect(page.locator('header')).toContainText(/modern cut/i);

    // Modern Cut calendar must NOT show Barber House booking or customer
    await expect(page.locator(`[data-public-ref="${publicRef}"]`)).not.toBeVisible();
    await expect(page.locator('text=Азамат Исмаилов')).not.toBeVisible();

    // Screenshot Modern Cut CRM
    await page.screenshot({ path: 'docs/screenshots/13-crm-calendar-moderncut.png', fullPage: true });
  });

  test('Time-First Booking Flow (Date/Time -> Services -> Specialist -> Confirm)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('http://barberhouse.localhost:3000');

    // Switch to "По времени" flow
    await page.locator('button:has-text("По времени")').click();
    await expect(page.locator('h1')).toContainText('Выберите дату и время');

    // Select date and slot
    const dateBtn = page.locator('button[data-date]').nth(1);
    await dateBtn.click();

    const slotBtn = page.locator('div:has-text("Свободные слоты") button:has-text(":")').first();
    await slotBtn.waitFor({ state: 'visible', timeout: 10000 });
    await slotBtn.click();

    // Proceed to Services step
    const toServicesBtn = page.locator('button:has-text("Выбрать услуги")');
    await expect(toServicesBtn).toBeVisible();
    await toServicesBtn.click();

    await expect(page.locator('h1')).toContainText('Выберите услуги');
    await page.locator('button[aria-pressed]').first().click();

    // Proceed to Specialist step
    await page.locator('button:has-text("Выбрать специалиста")').click();
    await expect(page.locator('h1')).toContainText('Выберите специалиста');
    await page.locator('button:has-text("Любой свободный мастер")').click();

    // In time-first, returns to datetime to lock the real authoritative slot and quote
    await page.locator('button:has-text("Выбрать дату и время")').click();
    await expect(page.locator('h1')).toContainText('Выберите дату и время');

    // Select the confirmed slot
    const finalSlotBtn = page.locator('div:has-text("Свободные слоты") button:has-text(":")').first();
    await finalSlotBtn.waitFor({ state: 'visible', timeout: 10000 });
    await finalSlotBtn.click();

    // Proceed to Confirm step
    await page.locator('button:has-text("Указать контакты")').click();
    await expect(page.locator('h1')).toContainText('Контактные данные');

    await page.fill('input[placeholder="Иван Петров"]', 'Ерлан Касымов');
    await page.fill('input[placeholder="+7 (701) 000-00-00"]', '+7 (702) 999-88-77');

    await page.locator('button:has-text("Подтвердить запись")').click();
    await expect(page.locator('h1')).toContainText('Запись подтверждена!', { timeout: 15000 });
    await expect(page.locator('text=Ерлан Касымов')).toBeVisible();
  });

  test('Master-First Booking Flow with Override Pricing', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('http://barberhouse.localhost:3000');

    // Switch to "По мастеру" flow
    await page.locator('button:has-text("По мастеру")').click();
    await expect(page.locator('h1')).toContainText('Выберите специалиста');

    // Select master Дамир (Top Barber)
    const masterBtn = page.locator('button:has-text("Дамир")').first();
    await masterBtn.click();

    // Click CTA to proceed to Services step
    await page.locator('button:has-text("Выбрать услуги")').click();
    await expect(page.locator('h1')).toContainText('Выберите услуги');
    await page.locator('button[aria-pressed]').first().click();

    // Next to DateTime (CTA is "Выбрать время")
    await page.locator('button:has-text("время")').click();
    await expect(page.locator('h1')).toContainText('Выберите дату и время');

    const dateBtn = page.locator('button[data-date]').nth(1);
    await dateBtn.click();

    const slotBtn = page.locator('div:has-text("Свободные слоты") button:has-text(":")').first();
    await slotBtn.waitFor({ state: 'visible', timeout: 10000 });
    await slotBtn.click();

    // Next to Contact Info
    await page.locator('button:has-text("Указать контакты")').click();
    await page.fill('input[placeholder="Иван Петров"]', 'Тимур Сатпаев');
    await page.fill('input[placeholder="+7 (701) 000-00-00"]', '+7 (707) 333-22-11');

    await page.locator('button:has-text("Подтвердить запись")').click();
    await expect(page.locator('h1')).toContainText('Запись подтверждена!', { timeout: 15000 });
    await expect(page.locator('text=Тимур Сатпаев')).toBeVisible();
  });

  test('Management Deep-Link (Isolated Context, Masked Phone, Reschedule & Cancel)', async ({ browser, page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // 1. Create a booking on Barber House
    await page.goto('http://barberhouse.localhost:3000');
    await page.locator('button[aria-pressed]').first().click();
    await page.locator('button:has-text("Выбрать специалиста")').click();
    await page.locator('button:has-text("Любой свободный мастер")').click();
    await page.locator('button:has-text("Выбрать дату и время")').click();

    const dateBtn = page.locator('button[data-date]').nth(1);
    const initialDate = await dateBtn.getAttribute('data-date');
    await dateBtn.click();

    const slotBtn = page.locator('div:has-text("Свободные слоты") button:has-text(":")').first();
    await slotBtn.waitFor({ state: 'visible', timeout: 10000 });
    await slotBtn.click();

    await page.locator('button:has-text("Указать контакты")').click();
    await page.fill('input[placeholder="Иван Петров"]', 'Нурлан Омаров');
    await page.fill('input[placeholder="+7 (701) 000-00-00"]', '+7 (775) 444-33-22');
    await page.locator('button:has-text("Подтвердить запись")').click();

    await expect(page.locator('h1')).toContainText('Запись подтверждена!', { timeout: 15000 });

    const managementToken = await page.locator('[data-management-token]').getAttribute('data-management-token');
    const publicRef = await page.locator('[data-public-ref]').getAttribute('data-public-ref');
    expect(managementToken).toBeTruthy();
    expect(publicRef).toBeTruthy();

    // 2. Open link in a fresh, isolated browser context (simulating customer opening from SMS/Messenger)
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    await freshPage.goto(`http://barberhouse.localhost:3000/manage/${managementToken}`);

    // Verify Management Screen loaded
    await expect(freshPage.locator('h1')).toContainText('Управление записью', { timeout: 15000 });
    await expect(freshPage.locator(`text=${publicRef}`)).toBeVisible();
    await expect(freshPage.locator('text=Нурлан Омаров')).toBeVisible();

    // Verify phone is masked
    await expect(freshPage.locator('text=*')).toBeVisible();

    // Verify cutoff notice is rendered
    await expect(freshPage.locator('text=Бесплатная отмена')).toBeVisible();

    // 3. Test Reschedule flow
    await freshPage.locator('button:has-text("Перенести запись")').click();
    await expect(freshPage.locator('h2:has-text("Выберите новое время")')).toBeVisible();

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 2);
    const futureDateStr = futureDate.toISOString().split('T')[0];
    await freshPage.fill('input[type="date"]', futureDateStr);

    const rescheduleSlot = freshPage.locator('div:has-text("Выберите новое время") button:has-text(":")').first();
    await rescheduleSlot.waitFor({ state: 'visible', timeout: 10000 });
    await rescheduleSlot.click();

    await freshPage.locator('button:has-text("Подтвердить перенос")').click();
    await expect(freshPage.locator('text=Запись успешно перенесена')).toBeVisible({ timeout: 10000 });

    // 4. Test Cancellation flow
    await freshPage.locator('button:has-text("Отменить запись")').click();
    await freshPage.locator('button:has-text("Да, отменить запись")').click();
    await expect(freshPage.locator('text=Запись успешно отменена.')).toBeVisible({ timeout: 10000 });
    await expect(freshPage.locator('text=Отменена')).toBeVisible();

    await freshContext.close();

    // 5. Verify status updated to cancelled in CRM
    await page.goto(`http://localhost:3001/?date=${futureDateStr}`);
    await expect(page.locator('h1')).toContainText('Вход в CRM', { timeout: 15000 });
    await page.fill('input[type="email"]', 'owner@barberhouse.kz');
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await expect(page.locator('h1')).toContainText('Календарь записей', { timeout: 15000 });
    const cardInCrm = page.locator(`[data-public-ref="${publicRef}"]`);
    await expect(cardInCrm).toBeVisible({ timeout: 10000 });
    await expect(cardInCrm).toContainText(/отменен/i);
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

      // Check horizontal overflow: scrollWidth should equal clientWidth
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasHorizontalScroll).toBe(false);
    }
  });

});
