import { test, expect } from '@playwright/test';

test.describe('Sprint M08 — Календарь (Журнал администратора)', () => {

  test.beforeEach(async ({ page }) => {
    // Open Business CRM and login as Barber House owner
    await page.goto('http://localhost:3001');
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await emailInput.fill('owner@barberhouse.kz');
      await page.fill('input[type="password"]', 'Password123!');
      await page.click('button[type="submit"]');
    }
    // Verify Calendar loaded
    await expect(page.locator('h1')).toContainText('Календарь', { timeout: 15000 });
  });

  test('M08-D1-01 & T08: Day and Week views, Time Blocking, Manual Booking, and Visit Card Lifecycle', async ({ page }) => {
    // 1. Day view verification
    await expect(page.locator('[data-testid="calendar-view-day"]')).toBeVisible();
    await expect(page.locator('text=Дамир').first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'docs/screenshots/sprint-m08-01-day-view.png', fullPage: true });

    // 2. Week view toggle
    await page.click('[data-testid="calendar-view-week"]');
    await expect(page.locator('text=Пн').first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'docs/screenshots/sprint-m08-02-week-view.png', fullPage: true });

    // Switch back to Day view
    await page.click('[data-testid="calendar-view-day"]');
    await expect(page.locator('text=Дамир').first()).toBeVisible({ timeout: 10000 });

    // 3. Time Blocking (DEMO GATE T08 UI)
    await page.click('[data-testid="calendar-create-block-btn"]');
    await expect(page.locator('h3:has-text("Блокировка времени")')).toBeVisible({ timeout: 5000 });

    // Select specialist Damir and safe evening time (17:00 - 18:00)
    const staffSelect = page.locator('select').first();
    if (await staffSelect.isVisible().catch(() => false)) {
      const options = await staffSelect.locator('option').allTextContents();
      const damirOption = options.find(o => o.includes('Дамир'));
      if (damirOption) {
        await staffSelect.selectOption({ label: damirOption });
      }
    }

    const timeInputs = page.locator('input[type="time"]');
    if (await timeInputs.count() >= 2) {
      await timeInputs.nth(0).fill('17:00');
      await timeInputs.nth(1).fill('18:00');
    }

    const reasonInput = page.locator('input[placeholder*="Причина"], input[value*="Обед"]').first();
    if (await reasonInput.isVisible().catch(() => false)) {
      await reasonInput.fill('Технический перерыв (M08 E2E)');
    }
    await page.click('[data-testid="submit-block-btn"]');
    await page.waitForTimeout(1000);

    // Verify block item is visible on calendar
    const blockEl = page.locator('[data-block-id]:has-text("17:00"), [data-block-id]:has-text("Технический")').first();
    await expect(blockEl).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'docs/screenshots/sprint-m08-03-calendar-block.png' });

    // 4. Open Block details and remove it (releasing slot)
    await blockEl.click();
    await expect(page.locator('[data-testid="delete-block-btn"]')).toBeVisible({ timeout: 5000 });
    await page.click('[data-testid="delete-block-btn"]');
    await page.waitForTimeout(1000);

    // 5. Manual Booking (Ручная запись из CRM)
    await page.click('[data-testid="calendar-create-booking-btn"]');
    await expect(page.locator('h3:has-text("Новая запись")')).toBeVisible({ timeout: 5000 });

    const custName = `Марат ${Math.floor(1000 + Math.random() * 9000)}`;
    const custPhone = `+7701${Math.floor(1000000 + Math.random() * 9000000)}`;

    await page.fill('[data-testid="booking-cust-name-input"]', custName);
    await page.fill('[data-testid="booking-cust-phone-input"]', custPhone);

    // Select Damir who works on Wednesday
    const bookingStaffSelect = page.locator('[data-testid="booking-staff-select"]');
    if (await bookingStaffSelect.isVisible().catch(() => false)) {
      const damirOption = bookingStaffSelect.locator('option:has-text("Дамир")').first();
      const damirVal = await damirOption.getAttribute('value');
      if (damirVal) {
        await bookingStaffSelect.selectOption(damirVal);
      }
    }

    const bookingTimeInput = page.locator('[data-testid="booking-time-input"]');
    if (await bookingTimeInput.isVisible().catch(() => false)) {
      await bookingTimeInput.fill('15:30');
    }

    // Select first service if checkboxes/radio exist
    const svcCheckbox = page.locator('input[type="checkbox"]').first();
    if (await svcCheckbox.isVisible().catch(() => false)) {
      const isChecked = await svcCheckbox.isChecked();
      if (!isChecked) await svcCheckbox.check();
    }

    // Submit new booking
    await page.click('[data-testid="submit-booking-btn"]');
    await page.waitForTimeout(1500);

    // Verify booking is visible in calendar
    const bookingEl = page.locator(`text=${custName}`).first();
    await expect(bookingEl).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'docs/screenshots/sprint-m08-04-booking-created.png' });

    // 6. Visit Card details & Status Lifecycle transitions
    await bookingEl.click();
    await expect(page.locator('[data-testid="visit-card-modal"]')).toBeVisible({ timeout: 5000 });

    // Verify initial status
    await expect(page.locator('[data-testid="visit-status-badge"]')).toContainText('Подтверждена');

    // Transition: Прибыл
    const arrivedBtn = page.locator('[data-testid="status-btn-arrived"]');
    if (await arrivedBtn.isVisible().catch(() => false)) {
      await arrivedBtn.click();
      await page.waitForTimeout(800);
      await expect(page.locator('[data-testid="visit-status-badge"]')).toContainText('Прибыл');
    }

    // Transition: В работе
    const inProgressBtn = page.locator('[data-testid="status-btn-in-progress"]');
    if (await inProgressBtn.isVisible().catch(() => false)) {
      await inProgressBtn.click();
      await page.waitForTimeout(800);
      await expect(page.locator('[data-testid="visit-status-badge"]')).toContainText('В работе');
    }

    // Transition: Завершить (Visit Completed)
    const completeBtn = page.locator('[data-testid="status-btn-completed"]');
    if (await completeBtn.isVisible().catch(() => false)) {
      await completeBtn.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('[data-testid="visit-status-badge"]')).toContainText('Завершен');
      // Verify authoritative debt tile appears
      await expect(page.locator('[data-testid="financial-debt-tile"]')).toBeVisible({ timeout: 5000 });
    }

    await page.screenshot({ path: 'docs/screenshots/sprint-m08-05-visit-completed.png' });

    // Close modal
    await page.click('[data-testid="visit-card-close-btn"]');
    await expect(page.locator('[data-testid="visit-card-modal"]')).not.toBeVisible();
  });

});
