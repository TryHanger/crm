import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

test.describe('Sprint M13 — Возвраты (сторнирование), авансы и кассовые смены (Z-отчет)', () => {

  test.beforeAll(() => {
    try {
      execSync('python scripts/clean_test_bookings.py', {
        stdio: 'inherit',
        env: { ...process.env, PYTHONPATH: '.' },
      });
    } catch (e) {
      console.warn('Could not reset test bookings via clean_test_bookings.py:', e);
    }
  });

  test.beforeEach(async ({ page }) => {
    // Open Business CRM and login as Barber House owner
    await page.goto('http://localhost:3001');
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await emailInput.fill('owner@barberhouse.kz');
      await page.fill('input[type="password"]', 'Password123!');
      await page.click('button[type="submit"]');
    }
    // Verify CRM layout loaded
    await expect(page.locator('nav')).toBeVisible({ timeout: 20000 });
  });

  test('M13-D1-01: Non-destructive corrective refund (storno) with mandatory reason preserves audit trail', async ({ page }) => {
    // 1. In calendar, open an existing booking or create one
    await page.click('[data-testid="calendar-create-booking-btn"]');
    await expect(page.locator('h3:has-text("Новая запись")')).toBeVisible({ timeout: 5000 });

    const custName = `Руслан Возврат ${Math.floor(1000 + Math.random() * 9000)}`;
    const custPhone = `+7708${Math.floor(1000000 + Math.random() * 9000000)}`;

    await page.fill('[data-testid="booking-cust-name-input"]', custName);
    await page.fill('[data-testid="booking-cust-phone-input"]', custPhone);

    const bookingStaffSelect = page.locator('[data-testid="booking-staff-select"]');
    if (await bookingStaffSelect.isVisible().catch(() => false)) {
      const options = await bookingStaffSelect.locator('option').allTextContents();
      const damirOption = options.find(o => o.includes('Дамир'));
      if (damirOption) {
        await bookingStaffSelect.selectOption({ label: damirOption });
      }
    }

    const bookingTimeInput = page.locator('[data-testid="booking-time-input"]');
    if (await bookingTimeInput.isVisible().catch(() => false)) {
      await bookingTimeInput.fill('16:00');
    }

    const svcCheckbox = page.locator('input[type="checkbox"]').first();
    if (await svcCheckbox.isVisible().catch(() => false)) {
      const isChecked = await svcCheckbox.isChecked();
      if (!isChecked) await svcCheckbox.check();
    }

    await page.click('[data-testid="submit-booking-btn"]');
    await page.waitForTimeout(1500);

    // Open booking card
    const bookingCard = page.locator(`text=${custName}`).first();
    await expect(bookingCard).toBeVisible({ timeout: 10000 });
    await bookingCard.click();
    await expect(page.locator('[data-testid="visit-card-modal"]')).toBeVisible({ timeout: 5000 });

    // Register initial payment of 4 000 KZT
    await page.click('[data-testid="register-payment-btn"]');
    await expect(page.locator('[data-testid="payment-modal"]')).toBeVisible({ timeout: 5000 });
    await page.fill('[data-testid="payment-amount-input"]', '4000');
    await page.click('[data-testid="submit-payment-btn"]');
    await page.waitForTimeout(1000);

    // Verify 4000 paid
    await expect(page.locator('text=4 000').first()).toBeVisible();

    // 2. Click Refund on the payment in history
    const historyBlock = page.locator('[data-testid="payment-history-block"]');
    await historyBlock.scrollIntoViewIfNeeded();
    const refundBtn = page.locator('[data-testid="refund-payment-btn"]').first();
    await expect(refundBtn).toBeVisible({ timeout: 5000 });
    await refundBtn.click();

    // 3. Verify Refund Modal
    const refundModal = page.locator('[data-testid="refund-modal"]');
    await expect(refundModal).toBeVisible({ timeout: 5000 });
    await expect(refundModal).toContainText('Оформление возврата');

    // Enter partial refund 1 000 KZT and choose reason
    await page.fill('[data-testid="refund-amount-input"]', '1000');
    const reasonChip = page.locator('[data-testid="refund-reason-chip"]').first();
    if (await reasonChip.isVisible().catch(() => false)) {
      await reasonChip.click();
    }
    await page.fill('[data-testid="refund-comment-input"]', 'Клиент отказался от укладки');

    await page.screenshot({ path: 'docs/screenshots/sprint-m13-01-refund-modal.png' });

    // Submit refund
    await page.click('[data-testid="confirm-refund-btn"]');
    await page.waitForTimeout(1000);

    // 4. Verify Non-destructive Storno:
    // Both original payment AND refund record must be visible!
    const historyList = page.locator('[data-testid="payment-history-block"]');
    await expect(historyList).toContainText('4 000');
    await expect(historyList).toContainText('1 000');
    await expect(historyList).toContainText('Возврат');

    // Effective paid is now 3000 KZT
    await expect(historyList).toContainText('Оплачено: 3 000 ₸');

    await page.screenshot({ path: 'docs/screenshots/sprint-m13-02-storno-audit-trail.png' });
    await page.click('[data-testid="visit-card-close-btn"]');
  });

  test('M13-D1-02: Cash Shift management: open shift, track advances, and close shift with Z-report reconciliation', async ({ page }) => {
    // 1. Navigate to "Касса и смены"
    const cashNav = page.locator('[data-testid="nav-cash"], button:has-text("Касса и смены")').first();
    await expect(cashNav).toBeVisible({ timeout: 10000 });
    await cashNav.click();

    await expect(page.locator('h1').first()).toContainText('Касса и смены', { timeout: 10000 });

    // If a shift is currently open, close it first to test fresh opening
    const existingCloseBtn = page.locator('[data-testid="close-shift-btn"]');
    if (await existingCloseBtn.isVisible().catch(() => false)) {
      await existingCloseBtn.click();
      await page.fill('[data-testid="actual-cash-input"]', '10000');
      await page.click('[data-testid="confirm-close-shift-btn"]');
      await page.waitForTimeout(1000);
    }

    // 2. Open Shift
    const openShiftBtn = page.locator('[data-testid="open-shift-btn"]').first();
    await expect(openShiftBtn).toBeVisible({ timeout: 5000 });
    await openShiftBtn.click();

    const openModal = page.locator('[data-testid="open-shift-modal"]');
    await expect(openModal).toBeVisible({ timeout: 5000 });
    await page.fill('[data-testid="opening-balance-input"]', '10000');

    await page.screenshot({ path: 'docs/screenshots/sprint-m13-03-open-shift-modal.png' });
    await page.click('[data-testid="confirm-open-shift-btn"]');
    await page.waitForTimeout(1000);

    // 3. Verify Active Shift Card
    const activeCard = page.locator('[data-testid="active-shift-card"]');
    await expect(activeCard).toBeVisible({ timeout: 5000 });
    await expect(activeCard).toContainText('Смена открыта');
    await expect(activeCard).toContainText('10 000 ₸');

    // 4. Register Customer Advance (separate from earned revenue)
    await page.click('[data-testid="add-advance-btn"]');
    const advanceModal = page.locator('[data-testid="advance-modal"]');
    await expect(advanceModal).toBeVisible({ timeout: 5000 });

    await page.fill('[data-testid="advance-amount-input"]', '2000');
    await page.fill('[data-testid="advance-customer-input"]', 'Диас Смагулов (+77019998877)');
    await page.screenshot({ path: 'docs/screenshots/sprint-m13-04-customer-advance-modal.png' });

    await page.click('[data-testid="submit-advance-btn"]');
    await page.waitForTimeout(1000);

    // Verify advances count and amount updated in active shift
    await expect(page.locator('[data-testid="shift-advances-stat"]')).toContainText(/2\s*000/);

    // 5. Close Shift (Z-Report Reconciliation)
    await page.click('[data-testid="close-shift-btn"]');
    const closeShiftModal = page.locator('[data-testid="close-shift-modal"]');
    await expect(closeShiftModal).toBeVisible({ timeout: 5000 });
    await expect(closeShiftModal).toContainText('Закрытие смены');

    // Enter matching actual cash in drawer
    await page.fill('[data-testid="actual-cash-input"]', '12000');
    await expect(page.locator('[data-testid="cash-difference"]')).toContainText(/сходится/i);

    await page.screenshot({ path: 'docs/screenshots/sprint-m13-05-z-report-reconciliation.png' });
    await page.click('[data-testid="confirm-close-shift-btn"]');
    await page.waitForTimeout(1000);

    // 6. Verify Shift History Table has closed shift
    const historyTable = page.locator('[data-testid="shifts-history-table"], [data-testid="shift-history-table"]');
    await expect(historyTable).toBeVisible({ timeout: 5000 });
    await expect(historyTable).toContainText('10 000 ₸');
    await page.screenshot({ path: 'docs/screenshots/sprint-m13-06-shift-history-table.png' });
  });

});
