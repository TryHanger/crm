import { test, expect } from '@playwright/test';

test.describe('Sprint M15 — Роли (мастер не видит кассу), приглашения и шаблоны уведомлений', () => {

  test('M15-D1-01: Master role restrictions (мастер не видит кассу, кассовые вкладки и отчеты скрыты)', async ({ page }) => {
    // 1. Login as Master (Damir)
    await page.goto('http://localhost:3001');
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await emailInput.fill('damir@barberhouse.kz');
      await page.fill('input[type="password"]', 'Password123!');
      await page.click('button[type="submit"]');
    }

    // Verify Calendar loaded
    await expect(page.locator('h1')).toContainText('Календарь', { timeout: 15000 });

    // Verify Master sidebar restrictions: Cash, Reports, Settings must NOT exist
    await expect(page.locator('aside >> text=Касса и смены')).not.toBeVisible();
    await expect(page.locator('aside >> text=Отчёты')).not.toBeVisible();
    await expect(page.locator('aside >> text=Настройки')).not.toBeVisible();

    // Verify allowed tabs
    await expect(page.locator('aside >> text=Календарь')).toBeVisible();
    await expect(page.locator('aside >> text=Клиенты')).toBeVisible();

    // 2. Open any booking on calendar and check "мастер не видит кассу" in visit card
    const bookingCards = page.locator('[data-booking-id]');
    if (await bookingCards.count() > 0) {
      await bookingCards.first().click();
      await expect(page.locator('[data-testid="visit-card-modal"]')).toBeVisible({ timeout: 5000 });

      // Financial breakdown MUST NOT be visible for master
      await expect(page.locator('[data-testid="visit-financial-block"]')).not.toBeVisible();

      // Master restricted view placeholder MUST be visible
      await expect(page.locator('[data-testid="master-restricted-view"]')).toBeVisible();
      await expect(page.locator('[data-testid="master-restricted-view"]')).toContainText('ролью управляющего');

      // Close modal
      await page.click('[data-testid="visit-card-close-btn"]');
    }

    // 3. Logout
    await page.locator('.crm-desktop-sidebar button:has-text("Выйти")').click();
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 5000 });
  });

  test('M15-D1-02: Owner role — Staff invitation with role selection (owner/admin/master)', async ({ page }) => {
    // 1. Login as Owner
    await page.goto('http://localhost:3001');
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await emailInput.fill('owner@barberhouse.kz');
      await page.fill('input[type="password"]', 'Password123!');
      await page.click('button[type="submit"]');
    }

    await expect(page.locator('h1')).toContainText('Календарь', { timeout: 15000 });

    // 2. Navigate to Settings
    await page.locator('aside >> text=Настройки').click();
    await expect(page.locator('h2:has-text("Настройки бизнеса")')).toBeVisible({ timeout: 10000 });

    // Switch to "Пользователи и роли" tab
    await page.locator('button:has-text("Пользователи и роли")').click();
    await expect(page.locator('[data-testid="invite-staff-btn"]')).toBeVisible({ timeout: 5000 });

    // 3. Open invite modal
    await page.click('[data-testid="invite-staff-btn"]');
    await expect(page.locator('h3:has-text("Пригласить сотрудника")')).toBeVisible({ timeout: 5000 });

    // Verify role options include master, admin, and owner
    const roleSelect = page.locator('[data-testid="invite-role-select"]');
    await expect(roleSelect).toBeVisible();
    const roleTexts = await roleSelect.locator('option').allTextContents();
    expect(roleTexts.some(t => t.includes('Мастер'))).toBeTruthy();
    expect(roleTexts.some(t => t.includes('Управляющий'))).toBeTruthy();
    expect(roleTexts.some(t => t.includes('Владелец'))).toBeTruthy();

    // Fill invitation form
    const uniqueEmail = `barber_${Date.now()}@barberhouse.kz`;
    await page.fill('[data-testid="invite-email-input"]', uniqueEmail);
    await roleSelect.selectOption('master');

    // Submit invitation
    await page.click('[data-testid="invite-submit-btn"]');
    await page.waitForTimeout(1500);

    // Verify generated invite URL input is visible and populated
    const urlInput = page.locator('[data-testid="invite-url-input"]');
    await expect(urlInput).toBeVisible({ timeout: 5000 });
    const urlValue = await urlInput.inputValue();
    expect(urlValue).toContain('/accept-invite?token=');

    // Verify copy button
    await expect(page.locator('[data-testid="invite-copy-btn"]')).toBeVisible();

    // Close modal
    await page.locator('h3:has-text("Пригласить сотрудника") ~ button, button:has-text("✕")').first().click();
  });

  test('M15-D1-03 & T15: Notification templates preview and client manage link', async ({ page }) => {
    // 1. Login as Owner
    await page.goto('http://localhost:3001');
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await emailInput.fill('owner@barberhouse.kz');
      await page.fill('input[type="password"]', 'Password123!');
      await page.click('button[type="submit"]');
    }

    await expect(page.locator('h1')).toContainText('Календарь', { timeout: 15000 });

    // 2. Open Settings -> Notifications tab
    await page.locator('aside >> text=Настройки').click();
    await expect(page.locator('[data-testid="settings-tab-notifications"]')).toBeVisible({ timeout: 10000 });
    await page.click('[data-testid="settings-tab-notifications"]');

    // Verify notifications view
    await expect(page.locator('[data-testid="settings-notifications-view"]')).toBeVisible({ timeout: 5000 });

    // Verify Transactional Outbox status (Demo gate T15)
    await expect(page.locator('[data-testid="notification-gateway-status"]')).toBeVisible();
    await expect(page.locator('[data-testid="notification-gateway-status"]')).toContainText('Транзакционный Email Шлюз: Активен');
    await expect(page.locator('[data-testid="notification-gateway-status"]')).toContainText('booking_id:event');

    // 3. Verify Template Previews
    // 3a. Confirmation Template with manage link
    await page.click('[data-testid="template-select-confirmation"]');
    await expect(page.locator('h4:has-text("Здравствуйте, Тимур!")')).toBeVisible();
    const manageLink = page.locator('[data-testid="notification-preview-manage-link"]');
    await expect(manageLink).toBeVisible();
    await expect(manageLink).toContainText('Управлять визитом');

    // 3b. Reminder Template
    await page.click('[data-testid="template-select-reminder"]');
    await expect(page.locator('h4:has-text("Напоминаем о визите через 2 часа!")')).toBeVisible();

    // 3c. Cancellation Template
    await page.click('[data-testid="template-select-cancellation"]');
    await expect(page.locator('h4:has-text("Запись отменена")')).toBeVisible();
    await expect(page.locator('[data-testid="notification-preview-rebook-link"]')).toBeVisible();

    // 4. Test notification dispatch
    await page.click('[data-testid="send-test-notification-btn"]');
    await expect(page.locator('text=Отправлено!')).toBeVisible({ timeout: 3000 });
  });

  test('M15-D1-04: Client self-management screen in booking-web (/manage/:token)', async ({ page }) => {
    // Open Booking Web with manage token under barberhouse tenant subdomain
    await page.goto('http://barberhouse.localhost:3000/manage/demo_tok_782');

    // Verify manage screen loads and displays management header or token alert
    const manageAlertOrHeader = page.locator('[role="alert"], h1:has-text("Управление записью")');
    await expect(manageAlertOrHeader.first()).toBeVisible({ timeout: 10000 });
  });

});
