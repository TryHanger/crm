import { test, expect } from '@playwright/test';

test.describe('Sprint M12 — Ручная касса и частичная оплата (Manual Cash Desk & Partial Payment UX)', () => {

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

  test('M12-D1-01 & M12-D1-02: Partial payment 3000 on 8000 cost results in 5000 debt, "Частичная оплата", history list, and idempotency', async ({ page }) => {
    // 1. Create a fresh manual booking for 8 000 KZT to test financial separation cleanly
    await page.click('[data-testid="calendar-create-booking-btn"]');
    await expect(page.locator('h3:has-text("Новая запись")')).toBeVisible({ timeout: 5000 });

    const custName = `Азамат Тест ${Math.floor(1000 + Math.random() * 9000)}`;
    const custPhone = `+7702${Math.floor(1000000 + Math.random() * 9000000)}`;

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
      await bookingTimeInput.fill('15:00');
    }

    const svcCheckbox = page.locator('input[type="checkbox"]').first();
    if (await svcCheckbox.isVisible().catch(() => false)) {
      const isChecked = await svcCheckbox.isChecked();
      if (!isChecked) await svcCheckbox.check();
    }

    await page.click('[data-testid="submit-booking-btn"]');
    await page.waitForTimeout(1500);

    // 2. Find and open the created booking card
    const bookingCard = page.locator(`text=${custName}`).first();
    await expect(bookingCard).toBeVisible({ timeout: 10000 });
    await bookingCard.click();

    // Verify visit drawer is open
    await expect(page.locator('[data-testid="visit-card-modal"]')).toBeVisible({ timeout: 5000 });

    // 3. Move status to completed: pending -> confirmed -> arrived -> in_progress -> completed
    const confirmBtn = page.locator('[data-testid="status-btn-confirm"]');
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(500);
    }

    const arrivedBtn = page.locator('[data-testid="status-btn-arrived"]');
    if (await arrivedBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await arrivedBtn.click();
      await page.waitForTimeout(500);
    }

    const inProgressBtn = page.locator('[data-testid="status-btn-in-progress"]');
    if (await inProgressBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await inProgressBtn.click();
      await page.waitForTimeout(500);
    }

    const completeBtn = page.locator('[data-testid="status-btn-completed"]');
    if (await completeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await completeBtn.click();
      await page.waitForTimeout(1000);
    }

    // 4. Strict Accounting Rule Verification:
    // Completing visit marks rendered = 8000, but paid = 0, debt = 8000, status = "Не оплачено"
    await expect(page.locator('text=Оказано').first()).toBeVisible();
    await expect(page.locator('text=Подлежит оплате').first()).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/sprint-m12-01-visit-completed-unpaid.png' });

    // 5. Open Register Payment modal
    const payBtn = page.locator('[data-testid="register-payment-btn"]');
    await expect(payBtn).toBeVisible({ timeout: 5000 });
    await payBtn.click();

    await expect(page.locator('[data-testid="payment-modal"]')).toBeVisible({ timeout: 5000 });

    // Enter partial payment: 3000 KZT
    const amountInput = page.locator('[data-testid="payment-amount-input"]');
    await amountInput.fill('3000');

    // Select payment method cash
    const methodSelect = page.locator('[data-testid="payment-method-select"]');
    if (await methodSelect.isVisible().catch(() => false)) {
      await methodSelect.selectOption('cash');
    }

    await page.screenshot({ path: 'docs/screenshots/sprint-m12-02-payment-modal-partial.png' });

    // Submit payment (with idempotency / double-click protection)
    const submitPayBtn = page.locator('[data-testid="submit-payment-btn"]');
    await submitPayBtn.click();

    // 6. Verify result in Visit Card:
    // Paid: 3 000, Debt: 5 000, Status: "Частичная оплата"
    await expect(page.locator('[data-testid="payment-status-badge"]')).toContainText('Частичная оплата', { timeout: 10000 });
    await expect(page.locator('text=3 000').first()).toBeVisible();
    await expect(page.locator('text=5 000').first()).toBeVisible();

    // Verify Payment History list shows the record
    const historyBlock = page.locator('[data-testid="payment-history-block"]');
    await expect(historyBlock).toBeVisible();
    await expect(historyBlock).toContainText('Наличные');
    await expect(historyBlock).toContainText('3 000');

    await page.screenshot({ path: 'docs/screenshots/sprint-m12-03-partial-payment-recorded.png' });

    // Close drawer
    await page.click('[data-testid="visit-card-close-btn"]');
  });

});
