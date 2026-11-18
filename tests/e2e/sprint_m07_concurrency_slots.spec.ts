import { test, expect } from '@playwright/test';

test.describe('Sprint M07 — Гарантия свободного слота (Concurrency & Slot UX)', () => {

  test('M07-D1-01 & T07: Slot conflict (409) displays friendly message, preserves inputs, and proposes alternative slots', async ({ page }) => {
    // Navigate to Barber House booking page
    await page.goto('http://barberhouse.localhost:3000');
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });

    // Step 1: Select a service
    const serviceBtn = page.locator('button[aria-pressed]').first();
    await serviceBtn.click();
    await page.locator('button:has-text("Выбрать специалиста")').click();

    // Step 2: Select Staff
    await expect(page.locator('h1')).toContainText('Выберите специалиста');
    await page.locator('button:has-text("Любой свободный мастер")').click();
    await page.locator('button:has-text("Выбрать дату и время")').click();

    // Step 3: Select Date & Time slot
    await expect(page.locator('h1')).toContainText('Выберите дату и время');
    const dateBtn = page.locator('button[data-date]').nth(1);
    if (await dateBtn.isVisible().catch(() => false)) {
      await dateBtn.click();
    }
    const slotBtn = page.locator('main button:has-text(":")').first();
    await slotBtn.waitFor({ state: 'visible', timeout: 10000 });
    await slotBtn.click();
    await page.locator('button:has-text("Указать контакты")').click();

    // Step 4: Fill customer contact info
    await expect(page.locator('h1')).toContainText('Контактные данные');
    await page.fill('input[placeholder="Иван Петров"]', 'Арман Касымов');
    await page.fill('input[placeholder="+7 (701) 000-00-00"]', '+7 (701) 555-44-33');

    // Mock API 409 Conflict: another user has just booked this slot!
    await page.route('**/api/v1/public/bookings', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'SLOT_TAKEN',
          message: 'К сожалению, выбранный слот только что был забронирован другим клиентом. Пожалуйста, выберите другое удобное время.',
          detail: {
            code: 'SLOT_TAKEN',
            message: 'Слот занят',
          },
        }),
      });
    });

    // Also mock searchAvailability to return alternative available slots
    await page.route('**/api/v1/public/availability/search', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total_count: 2,
          slots: [
            {
              starts_at_utc: '2026-11-20T10:30:00Z',
              service_ends_at_utc: '2026-11-20T11:15:00Z',
              staff_id: 'staff-damir',
              staff_name: 'Дамир Сериков',
              price_minor: 800000,
              duration_minutes: 45,
              quote_id: 'quote_alt_1',
            },
            {
              starts_at_utc: '2026-11-20T11:30:00Z',
              service_ends_at_utc: '2026-11-20T12:15:00Z',
              staff_id: 'staff-damir',
              staff_name: 'Дамир Сериков',
              price_minor: 800000,
              duration_minutes: 45,
              quote_id: 'quote_alt_2',
            },
          ],
        }),
      });
    });

    // Click confirm booking
    await page.click('button:has-text("Подтвердить запись")');

    // 5. Verify Slot Conflict Alert is shown (M07-D1-01)
    const conflictAlert = page.locator('[data-testid="slot-conflict-alert"]');
    await expect(conflictAlert).toBeVisible({ timeout: 5000 });
    await expect(conflictAlert).toContainText('Выбранный слот уже занят');
    await expect(conflictAlert).toContainText('Ваши контактные данные сохранены');

    // Verify customer input was NOT lost!
    await expect(page.locator('input[placeholder="Иван Петров"]')).toHaveValue('Арман Касымов');
    await expect(page.locator('input[placeholder="+7 (701) 000-00-00"]')).toHaveValue('+7 (701) 555-44-33');

    // 6. Verify alternative slots are offered immediately in the alert
    const altSlotsList = page.locator('[data-testid="alternative-slots-list"]');
    await expect(altSlotsList).toBeVisible();
    const altSlotButtons = page.locator('[data-testid="alt-slot-item"]');
    expect(await altSlotButtons.count()).toBeGreaterThanOrEqual(1);

    await page.screenshot({ path: 'docs/screenshots/sprint-m07-01-slot-conflict-alternatives.png', fullPage: true });

    // Click alternative slot
    await altSlotButtons.first().click();

    // Now mock successful booking on the newly selected alternative slot
    await page.unroute('**/api/v1/public/bookings');
    await page.route('**/api/v1/public/bookings', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'booking_m07_success',
          public_ref: 'BH-M07-99',
          status: 'pending',
          customer_name: 'Арман Касымов',
          customer_phone: '+77015554433',
          services: [{ id: 'srv-1', title: 'Стрижка', price_minor: 800000 }],
          starts_at_utc: '2026-11-20T10:30:00Z',
          service_ends_at_utc: '2026-11-20T11:15:00Z',
          staff_id: 'staff-damir',
          total_price_minor: 800000,
          currency: 'KZT',
          created_at: new Date().toISOString(),
        }),
      });
    });

    // Re-submit
    await page.click('button:has-text("Подтвердить запись")');
    await expect(page.locator('h1')).toContainText('Запись подтверждена!', { timeout: 10000 });
    await page.screenshot({ path: 'docs/screenshots/sprint-m07-02-alternative-booked.png', fullPage: true });
  });

  test('M07-D1-02: Quote TTL expiration and price change shows comparison and requires re-confirmation', async ({ page }) => {
    // Navigate to Barber House booking page
    await page.goto('http://barberhouse.localhost:3000');
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });

    // Step 1: Select a service
    const serviceBtn = page.locator('button[aria-pressed]').first();
    await serviceBtn.click();
    await page.locator('button:has-text("Выбрать специалиста")').click();

    // Step 2: Staff
    await page.locator('button:has-text("Любой свободный мастер")').click();
    await page.locator('button:has-text("Выбрать дату и время")').click();

    // Step 3: Slot
    const dateBtn = page.locator('button[data-date]').nth(1);
    if (await dateBtn.isVisible().catch(() => false)) {
      await dateBtn.click();
    }
    const slotBtn = page.locator('main button:has-text(":")').first();
    await slotBtn.waitFor({ state: 'visible', timeout: 10000 });
    await slotBtn.click();
    await page.locator('button:has-text("Указать контакты")').click();

    // Step 4: Contact details
    await page.fill('input[placeholder="Иван Петров"]', 'Ерлан Омаров');
    await page.fill('input[placeholder="+7 (701) 000-00-00"]', '+7 (707) 123-45-67');

    // Mock API 409 QUOTE_EXPIRED / PRICE_CHANGED
    await page.route('**/api/v1/public/bookings', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'QUOTE_EXPIRED',
          message: 'Срок действия предварительного расчета истек или стоимость изменилась.',
          detail: {
            code: 'QUOTE_EXPIRED',
            old_price_minor: 700000,
            new_price_minor: 850000,
            new_quote_id: 'new_quote_refreshed_123',
          },
        }),
      });
    });

    // Click confirm booking
    await page.click('button:has-text("Подтвердить запись")');

    // Verify Quote Changed Alert
    const quoteAlert = page.locator('[data-testid="quote-changed-alert"]');
    await expect(quoteAlert).toBeVisible({ timeout: 5000 });
    await expect(quoteAlert).toContainText('Условия бронирования изменились');
    await expect(quoteAlert).toContainText(/7\s*000/);
    await expect(quoteAlert).toContainText(/8\s*500/);

    // Customer input preserved
    await expect(page.locator('input[placeholder="Иван Петров"]')).toHaveValue('Ерлан Омаров');

    await page.screenshot({ path: 'docs/screenshots/sprint-m07-03-price-changed-banner.png', fullPage: true });

    // Accept new price
    const acceptBtn = page.locator('[data-testid="accept-price-btn"]');
    await expect(acceptBtn).toBeVisible();

    // Mock success after accepting price
    await page.unroute('**/api/v1/public/bookings');
    await page.route('**/api/v1/public/bookings', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'booking_m07_quote_success',
          public_ref: 'BH-PRICE-01',
          status: 'pending',
          customer_name: 'Ерлан Омаров',
          customer_phone: '+77071234567',
          services: [{ id: 'srv-1', title: 'Стрижка', price_minor: 850000 }],
          starts_at_utc: '2026-11-20T10:30:00Z',
          service_ends_at_utc: '2026-11-20T11:15:00Z',
          total_price_minor: 850000,
          currency: 'KZT',
          created_at: new Date().toISOString(),
        }),
      });
    });

    await acceptBtn.click();
    await page.click('button:has-text("Подтвердить запись")');
    await expect(page.locator('h1')).toContainText('Запись подтверждена!', { timeout: 10000 });
  });

});
