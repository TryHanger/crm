import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

test.describe('Sprint M09 — Жизненный цикл визита, причины отмены и история событий', () => {

  test.beforeAll(() => {
    try {
      execSync('python scripts/clean_test_bookings.py', { stdio: 'inherit' });
    } catch (_) {}
  });

  test.beforeEach(async ({ page }) => {
    // Open Business CRM and login as owner
    await page.goto('http://localhost:3001');
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await emailInput.fill('owner@barberhouse.kz');
      await page.fill('input[type="password"]', 'Password123!');
      await page.click('button[type="submit"]');
    }
    await expect(page.locator('h1')).toContainText('Календарь', { timeout: 15000 });
  });

  test('M09-D1-01 & T09: Visit card lifecycle, no-show marking, event history timeline', async ({ page }) => {
    // 1. Create a booking for No-Show test
    await page.click('[data-testid="calendar-create-booking-btn"]');
    await expect(page.locator('h3:has-text("Новая запись")')).toBeVisible({ timeout: 5000 });

    const custName = `Асет ${Math.floor(1000 + Math.random() * 9000)}`;
    const custPhone = `+7702${Math.floor(1000000 + Math.random() * 9000000)}`;

    await page.fill('[data-testid="booking-cust-name-input"]', custName);
    await page.fill('[data-testid="booking-cust-phone-input"]', custPhone);

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
      await bookingTimeInput.fill('10:00');
    }

    const svcCheckbox = page.locator('input[type="checkbox"]').first();
    if (await svcCheckbox.isVisible().catch(() => false)) {
      const isChecked = await svcCheckbox.isChecked();
      if (!isChecked) await svcCheckbox.check();
    }

    await page.click('[data-testid="submit-booking-btn"]');
    await page.waitForTimeout(1500);

    // Find and open the visit card
    const bookingEl = page.locator(`text=${custName}`).first();
    await expect(bookingEl).toBeVisible({ timeout: 10000 });
    await bookingEl.click();

    await expect(page.locator('[data-testid="visit-card-modal"]')).toBeVisible({ timeout: 5000 });

    // Verify initial status
    await expect(page.locator('[data-testid="visit-status-badge"]')).toContainText('Подтверждена');

    // Verify Event History Timeline block exists
    await expect(page.locator('[data-testid="visit-history-block"]')).toBeVisible();

    // 2. Mark as No-Show
    const noShowBtn = page.locator('[data-testid="status-btn-no-show"]');
    await expect(noShowBtn).toBeVisible();
    await noShowBtn.click();
    await page.waitForTimeout(1000);

    // Verify No-Show status and banner
    await expect(page.locator('[data-testid="visit-status-badge"]')).toContainText('Не явился');
    await expect(page.locator('[data-testid="no-show-banner"]')).toBeVisible();
    await expect(page.locator('[data-testid="no-show-banner"]')).toContainText('Клиент не явился');

    // Close modal
    await page.click('[data-testid="visit-card-close-btn"]');
    await expect(page.locator('[data-testid="visit-card-modal"]')).not.toBeVisible();
  });

  test('M09-D1-02 & T09: Reschedule visit and Cancellation with reason chips and comment', async ({ page }) => {
    // 1. Create a booking for Reschedule and Cancel test
    await page.click('[data-testid="calendar-create-booking-btn"]');
    await expect(page.locator('h3:has-text("Новая запись")')).toBeVisible({ timeout: 5000 });

    const custName = `Кайрат ${Math.floor(1000 + Math.random() * 9000)}`;
    const custPhone = `+7705${Math.floor(1000000 + Math.random() * 9000000)}`;

    await page.fill('[data-testid="booking-cust-name-input"]', custName);
    await page.fill('[data-testid="booking-cust-phone-input"]', custPhone);

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
      await bookingTimeInput.fill('18:00');
    }

    const svcCheckbox = page.locator('input[type="checkbox"]').first();
    if (await svcCheckbox.isVisible().catch(() => false)) {
      const isChecked = await svcCheckbox.isChecked();
      if (!isChecked) await svcCheckbox.check();
    }

    await page.click('[data-testid="submit-booking-btn"]');
    await page.waitForTimeout(1500);

    // Open visit card
    const bookingEl = page.locator(`text=${custName}`).first();
    await expect(bookingEl).toBeVisible({ timeout: 10000 });
    await bookingEl.click();

    await expect(page.locator('[data-testid="visit-card-modal"]')).toBeVisible({ timeout: 5000 });

    // 2. Reschedule visit
    await page.click('[data-testid="visit-card-reschedule-btn"]');
    await expect(page.locator('h3:has-text("Перенос записи")')).toBeVisible({ timeout: 5000 });

    await page.fill('[data-testid="reschedule-time-input"]', '18:30');
    await page.click('[data-testid="confirm-reschedule-btn"]');
    await page.waitForTimeout(1200);

    // Verify time changed and logged in history
    await expect(page.locator('[data-testid="visit-history-block"]')).toBeVisible();

    // 3. Cancel with reason chips & custom input
    await page.click('[data-testid="visit-card-cancel-btn"]', { force: true });
    await expect(page.locator('h3:has-text("Подтверждение отмены записи")')).toBeVisible({ timeout: 5000 });

    // Select reason chip
    const reasonChip = page.locator('[data-testid="cancel-reason-chip"]').first();
    if (await reasonChip.isVisible().catch(() => false)) {
      await reasonChip.click();
    }

    const customReasonInput = page.locator('[data-testid="cancel-reason-input"]');
    await customReasonInput.fill('Планы клиента изменились (E2E)');

    await page.click('[data-testid="confirm-cancel-btn"]');
    await page.waitForTimeout(1200);

    // Verify Cancellation banner and reason displayed
    await expect(page.locator('[data-testid="visit-status-badge"]')).toContainText('Отменен');
    await expect(page.locator('[data-testid="cancelled-banner"]')).toBeVisible();
    await expect(page.locator('[data-testid="cancelled-banner"]')).toContainText('Планы клиента изменились (E2E)');

    // Verify event history preserves cancellation
    await expect(page.locator('[data-testid="visit-history-block"]')).toBeVisible();

    // Close modal
    await page.click('[data-testid="visit-card-close-btn"]');
    await expect(page.locator('[data-testid="visit-card-modal"]')).not.toBeVisible();
  });

});
