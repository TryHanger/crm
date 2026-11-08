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

    // Select "Завтра" to pick a working day
    const tomorrowBtn = page.locator('button:has-text("Завтра"), button:has-text("вт")').first();
    await tomorrowBtn.click();

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
    await expect(page.locator('h1')).toContainText('Запись подтверждена!', { timeout: 10000 });
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

    // Select "Завтра"
    const tomorrowBtn = page.locator('button:has-text("Завтра"), button:has-text("вт")').first();
    await tomorrowBtn.click();

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
    await expect(page.locator('h1')).toContainText('Запись подтверждена!', { timeout: 10000 });
    await page.screenshot({ path: 'docs/screenshots/11-mobile-booking-confirmed.png' });
  });

  test('CRM Calendar Flow - Barber House & Modern Cut', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // 1. Visit CRM
    await page.goto('http://localhost:3001');

    // Wait for calendar to load
    await expect(page.locator('h1')).toContainText('Календарь записей', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Screenshot Barber House CRM
    await page.screenshot({ path: 'docs/screenshots/12-crm-calendar-barberhouse.png', fullPage: true });

    // 2. Switch tenant to Modern Cut
    const tenantSelect = page.locator('select').first();
    await tenantSelect.selectOption('moderncut');

    await expect(page.locator('header')).toContainText('MODERN CUT CRM', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Screenshot Modern Cut CRM
    await page.screenshot({ path: 'docs/screenshots/13-crm-calendar-moderncut.png', fullPage: true });
  });

});
