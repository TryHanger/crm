import { test, expect } from '@playwright/test';

test.describe('Sprint M05: Master Schedules, Dynamic Breaks, Vacations, and Individual Master Pricing', () => {

  test('M05 End-to-End: Configure Master Prices, Schedules & Time-Off in CRM; Verify on Public Booking Site', async ({ page, context }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 1280, height: 850 });

    // 1. Log in to CRM as Barber House Owner
    await page.goto('http://localhost:3001');
    await page.fill('input[type="email"]', 'owner@barberhouse.kz');
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button[type="submit"]');

    // Wait for CRM navigation
    await expect(page.locator('nav')).toBeVisible({ timeout: 15000 });

    // 2. Navigate to Staff Module
    await page.click('nav a:has-text("Сотрудники"), aside button:has-text("Сотрудники")');
    await expect(page.locator('h1')).toContainText('Сотрудники');

    // Verify staff rows are present (Damir and Erzhan)
    const damirRow = page.locator('tr:has-text("Дамир")');
    await expect(damirRow).toBeVisible({ timeout: 15000 });
    const erzhanRow = page.locator('tr:has-text("Ержан")');
    await expect(erzhanRow).toBeVisible();

    // 3. Open Damir Modal
    await damirRow.click();
    await expect(page.locator('h3:has-text("Дамир")')).toBeVisible({ timeout: 10000 });

    // --- TAB 1: Profile & Branches ---
    await page.click('button:has-text("Профиль и филиалы")');
    await expect(page.locator('text=Привязка мастера к филиалам:')).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/sprint-m05-01-crm-damir-profile.png' });

    // --- TAB 2: Services & Custom Pricing ---
    await page.click('button:has-text("Услуги и цены")');
    await expect(page.locator('text=Назначьте услуги и укажите индивидуальную стоимость')).toBeVisible({ timeout: 10000 });

    // Find "Мужская стрижка" service row and set custom price 8 000 KZT
    const damirServiceRow = page.locator('[data-testid^="service-offer-row-"]').filter({ hasText: 'Мужская стрижка' }).first();
    const serviceCheckbox = damirServiceRow.locator('input[type="checkbox"]');
    if (!(await serviceCheckbox.isChecked())) {
      await serviceCheckbox.check();
    }
    const priceInput = damirServiceRow.locator('input[type="number"]').first();
    if (await priceInput.isVisible()) {
      await priceInput.fill('8000');
    }
    await page.click('button:has-text("Сохранить цены")');
    await expect(page.locator('text=Индивидуальные цены сохранены')).toBeVisible({ timeout: 8000 });
    await page.screenshot({ path: 'docs/screenshots/sprint-m05-02-crm-damir-services.png' });

    // --- TAB 3: Schedule & Breaks ---
    await page.click('button:has-text("График и перерывы")');
    await expect(page.locator('text=Настройте рабочие часы и обеденные перерывы')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Понедельник')).toBeVisible();
    await expect(page.locator('button:has-text("Сохранить график")')).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/sprint-m05-03-crm-damir-schedule.png' });

    // --- TAB 4: Vacations & Time Off ---
    await page.click('button:has-text("Отпуск и отгулы")');
    await expect(page.locator('text=Оформить отпуск или отгул')).toBeVisible({ timeout: 10000 });
    await page.fill('input[type="date"] >> nth=0', '2026-12-10');
    await page.fill('input[type="date"] >> nth=1', '2026-12-15');
    await page.fill('input[placeholder*="Ежегодный отпуск"]', 'Плановый отпуск мастера');
    await page.click('form button[type="submit"]');
    await expect(page.locator('text=2026-12-10 — 2026-12-15').first()).toBeVisible({ timeout: 8000 });
    await page.screenshot({ path: 'docs/screenshots/sprint-m05-04-crm-damir-vacation.png' });

    // Close Damir Modal
    await page.click('button:has-text("✕")');

    // 4. Open Erzhan Modal and set 12 000 KZT price
    await erzhanRow.click();
    await expect(page.locator('h3:has-text("Ержан")')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Услуги и цены")');
    await expect(page.locator('text=Назначьте услуги и укажите индивидуальную стоимость')).toBeVisible({ timeout: 10000 });

    const erzhanServiceRow = page.locator('[data-testid^="service-offer-row-"]').filter({ hasText: 'Мужская стрижка' }).first();
    const erzhanCheckbox = erzhanServiceRow.locator('input[type="checkbox"]');
    if (!(await erzhanCheckbox.isChecked())) {
      await erzhanCheckbox.check();
    }
    const erzhanPriceInput = erzhanServiceRow.locator('input[type="number"]').first();
    await erzhanPriceInput.waitFor({ state: 'visible', timeout: 5000 });
    await erzhanPriceInput.fill('12000');
    await page.click('button:has-text("Сохранить цены")');
    await expect(page.locator('text=Индивидуальные цены сохранены')).toBeVisible({ timeout: 8000 });
    await page.screenshot({ path: 'docs/screenshots/sprint-m05-05-crm-erzhan-services.png' });

    // Close Erzhan Modal
    await page.click('button:has-text("✕")');

    // 5. Open Public Booking Web and verify individual prices per master
    const bookingPage = await context.newPage();
    bookingPage.on('console', msg => console.log('BROWSER LOG:', msg.text()));
    bookingPage.on('response', async resp => {
      if (resp.url().includes('/api/v1/public/staff')) {
        try {
          const json = await resp.json();
          console.log('PUBLIC STAFF RESP (' + resp.url() + '):', JSON.stringify(json));
        } catch {}
      }
    });
    await bookingPage.setViewportSize({ width: 1280, height: 850 });
    await bookingPage.goto('http://barberhouse.localhost:3000');
    await expect(bookingPage.locator('body')).toBeVisible({ timeout: 15000 });

    // If branch selection step is shown, select first branch
    const branchChoice = bookingPage.locator('[data-testid="branch-card"], button:has-text("Филиал"), button:has-text("Выбрать филиал")').first();
    if (await branchChoice.isVisible()) {
      await branchChoice.click();
    }

    // Select the service "Мужская стрижка"
    const serviceCard = bookingPage.locator('button[data-testid="service-item"]').filter({ hasText: 'Мужская стрижка' });
    await expect(serviceCard).toBeVisible({ timeout: 15000 });
    await serviceCard.click();
    await expect(serviceCard).toHaveAttribute('aria-pressed', 'true');

    // Advance to Staff Selection Step
    const continueBtn = bookingPage.locator('button:has-text("Выбрать специалиста")');
    await expect(continueBtn).toBeEnabled({ timeout: 10000 });
    await continueBtn.click();

    // 6. Verify Staff Step displays individual prices
    await expect(bookingPage.locator('h1:has-text("Выберите специалиста")')).toBeVisible({ timeout: 10000 });

    // Damir must show 8 000 ₸
    const damirCard = bookingPage.locator('button:has-text("Дамир")');
    await expect(damirCard).toBeVisible({ timeout: 10000 });
    await expect(damirCard).toContainText(/8[\s\u00a0]000\s*₸/, { timeout: 10000 });

    // Erzhan must show 12 000 ₸
    const erzhanCard = bookingPage.locator('button:has-text("Ержан")');
    await expect(erzhanCard).toBeVisible({ timeout: 10000 });
    await expect(erzhanCard).toContainText(/12[\s\u00a0]000\s*₸/, { timeout: 10000 });

    // Any master option must show "от 8 000 ₸"
    const anyMasterCard = bookingPage.locator('button:has-text("Любой")');
    await expect(anyMasterCard).toBeVisible({ timeout: 10000 });
    await expect(anyMasterCard).toContainText(/от\s*8[\s\u00a0]000\s*₸/, { timeout: 10000 });

    await bookingPage.screenshot({ path: 'docs/screenshots/sprint-m05-06-public-individual-prices.png' });

    // 7. Select Damir and proceed to Date & Time step
    await damirCard.click();
    const nextToTimeBtn = bookingPage.locator('button:has-text("Выбрать дату и время")');
    await expect(nextToTimeBtn).toBeEnabled({ timeout: 10000 });
    await nextToTimeBtn.click();

    // Verify Date & Time step is shown
    await expect(bookingPage.locator('h1:has-text("Выберите дату и время")')).toBeVisible({ timeout: 10000 });
    await bookingPage.screenshot({ path: 'docs/screenshots/sprint-m05-07-public-damir-slots.png' });

    await bookingPage.close();
  });
});
