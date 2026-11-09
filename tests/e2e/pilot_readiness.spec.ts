import { test, expect } from '@playwright/test';

test.describe('PR-5: Pilot Readiness & First Company Lifecycle Suite', () => {
  test.describe.configure({ mode: 'serial' });
  const PLATFORM_URL = 'http://127.0.0.1:3002';
  const CRM_URL = 'http://127.0.0.1:3001';
  const BOOKING_URL = 'http://127.0.0.1:3000';
  const API_URL = 'http://127.0.0.1:8000';

  const runId = Date.now().toString().slice(-5);
  const pilotSlug = `pilot${runId}`;
  const pilotName = `Pilot Studio ${runId}`;
  const pilotOwnerEmail = `owner_${pilotSlug}@pilotkz.internal`;
  const pilotPassword = `PilotPass_${runId}!`;
  let inviteToken = '';
  let inviteUrl = '';
  let pilotTenantId = '';
  let pilotBranchId = '';
  let bookedPublicRef = '';

  test('PR-5.1: Real Onboarding Wizard & Safe Invite Delivery (PR-2)', async ({ page }) => {
    // 1. Platform owner logs in to Platform Console
    await page.goto(PLATFORM_URL);
    await page.click('[data-testid="quick-login-owner"]');
    await page.click('[data-testid="platform-login-submit-btn"]');
    await expect(page.locator('[data-testid="platform-user-role-badge"]')).toContainText('Владелец платформы');

    // 2. Open Companies and launch Onboarding Wizard
    await page.click('[data-testid="platform-nav-companies"]');
    await page.click('[data-testid="new-tenant-open-wizard-btn"]');
    await expect(page.locator('[data-testid="onboarding-wizard-modal"]')).toBeVisible();

    // Step 1: Details
    await page.fill('[data-testid="wizard-input-name"]', pilotName);
    await page.fill('[data-testid="wizard-input-slug"]', pilotSlug);
    await page.click('[data-testid="wizard-step1-next-btn"]');

    // Step 2: Plan Selection
    await page.click('[data-testid="wizard-plan-option-start"]');
    await page.click('[data-testid="wizard-step2-next-btn"]');

    // Step 3: Owner info without pre-seeded credentials
    await page.fill('[data-testid="wizard-input-owner-name"]', 'Алибек Сериков');
    await page.fill('[data-testid="wizard-input-owner-email"]', pilotOwnerEmail);
    await page.click('[data-testid="wizard-finish-btn"]');

    // Step 4: Verification of single-use invite link
    await expect(page.locator('[data-testid="wizard-step4-success"]')).toBeVisible();
    await expect(page.locator('[data-testid="wizard-invite-url-display"]')).toBeVisible();
    inviteUrl = await page.inputValue('[data-testid="wizard-invite-url-display"]');
    expect(inviteUrl).toContain('/accept-invite?token=');
    const tokenMatch = inviteUrl.match(/token=([^&]+)/);
    expect(tokenMatch).toBeTruthy();
    inviteToken = tokenMatch![1];

    // Screenshot of generated invite in Platform Console
    await page.screenshot({ path: 'docs/screenshots/pilot-01-onboarding-invite.png', fullPage: true });

    // Inspect Tenant Details in Console
    await page.click('[data-testid="wizard-go-to-tenant-btn"]');
    await expect(page.locator('[data-testid="tenant-detail-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="tenant-detail-status-pill"]')).toContainText('Активн');
  });

  test('PR-5.2: Owner Password Setup & CRM Login Activation (PR-2)', async ({ page }) => {
    expect(inviteToken).toBeTruthy();

    // 1. New owner opens the invitation URL on Business CRM
    await page.goto(`${CRM_URL}/accept-invite?token=${inviteToken}`);
    await expect(page.locator('[data-testid="accept-invite-page"]')).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/pilot-02-crm-activation.png', fullPage: true });

    // 2. Validate password mismatch validation
    await page.fill('[data-testid="invite-name-input"]', 'Алибек Сериков');
    await page.fill('[data-testid="invite-password-input"]', pilotPassword);
    await page.fill('[data-testid="invite-confirm-password-input"]', 'MismatchPassword999!');
    await page.click('[data-testid="invite-submit-btn"]');
    await expect(page.locator('[data-testid="accept-invite-error"]')).toContainText('Пароли не совпадают');

    // 3. Complete activation with matching secure password
    await page.fill('[data-testid="invite-confirm-password-input"]', pilotPassword);
    await page.click('[data-testid="invite-submit-btn"]');

    // 4. Automatically redirects into Business CRM dashboard
    await expect(page.locator('h1')).toContainText('Календарь записей', { timeout: 15000 });
    await expect(page.locator('header')).toContainText(new RegExp(pilotName, 'i'));

    // 5. Verify single-use token invalidation: trying to reuse the same token displays error in a fresh context
    const freshContext = await page.context().browser()!.newContext();
    const reusePage = await freshContext.newPage();
    await reusePage.goto(`${CRM_URL}/accept-invite?token=${inviteToken}`);
    await expect(reusePage.locator('[data-testid="accept-invite-page"]')).toBeVisible();
    await reusePage.fill('[data-testid="invite-password-input"]', pilotPassword);
    await reusePage.fill('[data-testid="invite-confirm-password-input"]', pilotPassword);
    await reusePage.click('[data-testid="invite-submit-btn"]');
    await expect(reusePage.locator('[data-testid="accept-invite-error"]')).toBeVisible();
    await freshContext.close();
  });

  test('PR-5.3: Branch, Staff, Service & Online Booking Publishing', async ({ page }) => {
    // 1. Login as the newly activated Pilot Owner
    await page.goto(CRM_URL);
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailInput.fill(pilotOwnerEmail);
      await page.fill('input[type="password"]', pilotPassword);
      await page.click('button[type="submit"]');
      await expect(page.locator('h1')).toContainText('Календарь записей', { timeout: 15000 });
    }

    // 2. Setup First Branch in Settings -> Branches
    await page.click('nav a:has-text("Настройки"), aside button:has-text("Настройки")');
    await expect(page.locator('h1')).toContainText('Настройки бизнеса');
    await page.click('button:has-text("Филиалы")');
    await page.click('button:has-text("+ Добавить филиал")');
    const branchTitle = `Филиал Центр ${runId}`;
    await page.fill('input[placeholder="Например: Barber House Астана (Достык)"]', branchTitle);
    await page.fill('input[placeholder="ул. Достык, 12, 1 этаж"]', 'пр. Достык, 42');
    await page.click('button:has-text("Сохранить филиал")');
    await expect(page.locator(`text=${branchTitle}`)).toBeVisible({ timeout: 10000 });

    // 3. Create Staff member
    await page.click('nav a:has-text("Сотрудники"), aside button:has-text("Сотрудники")');
    await expect(page.locator('h1')).toContainText('Сотрудники и график');

    await page.click('button:has-text("+ Сотрудник")');
    const masterName = `Мастер ${runId}`;
    await page.fill('input[placeholder="Руслан Ибрагимов"]', masterName);
    await page.click('form button:has-text("Добавить")');
    await expect(page.locator(`text=${masterName}`)).toBeVisible({ timeout: 10000 });

    // 3. Add Service
    await page.click('nav a:has-text("Услуги"), aside button:has-text("Услуги")');
    await expect(page.locator('h1')).toContainText('Услуги и цены');

    await page.click('button:has-text("+ Услуга")');
    const serviceTitle = `Пилотная стрижка ${runId}`;
    await page.fill('input[placeholder="Стрижка бороды"]', serviceTitle);
    await page.fill('input[type="number"] >> nth=0', '7500');
    await page.click('form button:has-text("Добавить")');
    await expect(page.locator(`text=${serviceTitle}`)).toBeVisible({ timeout: 10000 });

    // 4. Verify & Enable Online Booking Publication
    await page.click('nav a:has-text("Онлайн-запись"), aside button:has-text("Онлайн-запись")');
    await expect(page.locator('h1')).toContainText('Настройки онлайн-записи');
    await page.screenshot({ path: 'docs/screenshots/pilot-03-booking-settings.png', fullPage: true });

    const publishToggle = page.locator('button:has-text("Опубликовать"), button:has-text("Опубликовано"), button[role="switch"]');
    if (await publishToggle.isVisible()) {
      const text = await publishToggle.textContent();
      if (text?.includes('Опубликовать') && !text?.includes('Опубликовано')) {
        await publishToggle.click();
        await expect(page.locator('text=Опубликовано')).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('PR-5.4: End-to-End Client Booking & Sync into CRM Calendar', async ({ page }) => {
    // 1. Visit Booking Web for this pilot tenant via its host
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`http://${pilotSlug}.localhost:3000`);

    // Verify brand header
    await expect(page.locator('header')).toContainText(new RegExp(pilotName, 'i'));
    await expect(page.locator('h1')).toContainText('Выберите услуги');

    // 2. Select service
    const firstServiceBtn = page.locator('button[aria-pressed]').first();
    await firstServiceBtn.click();
    await expect(firstServiceBtn).toHaveAttribute('aria-pressed', 'true');

    // 3. Move to Specialist Step
    await page.locator('button:has-text("Выбрать специалиста")').click();
    await expect(page.locator('h1')).toContainText('Выберите специалиста');
    await page.locator('button:has-text("Любой свободный мастер")').click();

    // 4. Move to DateTime Step
    await page.locator('button:has-text("Выбрать дату и время")').click();
    await expect(page.locator('h1')).toContainText('Выберите дату и время');

    // Select date and slot
    const dateBtn = page.locator('button[data-date]').nth(1);
    const targetDate = await dateBtn.getAttribute('data-date');
    expect(targetDate).toBeTruthy();
    await dateBtn.click();

    const slotBtn = page.locator('main button:has-text(":")').first();
    await slotBtn.waitFor({ state: 'visible', timeout: 10000 });
    await slotBtn.click();

    // 5. Contact Details
    await page.locator('button:has-text("Указать контакты")').click();
    await expect(page.locator('h1')).toContainText('Контактные данные');
    await page.fill('input[placeholder="Иван Петров"]', 'Ерлан Мусин');
    await page.fill('input[placeholder="+7 (701) 000-00-00"]', '+7 (702) 888-99-00');
    await page.screenshot({ path: 'docs/screenshots/pilot-04-booking-form.png', fullPage: true });

    // Submit booking
    await page.locator('button:has-text("Подтвердить запись")').click();
    await expect(page.locator('h1')).toContainText('Запись подтверждена!', { timeout: 15000 });

    bookedPublicRef = (await page.locator('[data-public-ref]').getAttribute('data-public-ref')) || '';
    expect(bookedPublicRef).toBeTruthy();
    await page.screenshot({ path: 'docs/screenshots/pilot-05-booking-confirmation.png', fullPage: true });

    // 6. Open Business CRM Calendar and confirm immediate reflection of the booking
    await page.goto(`${CRM_URL}/?date=${targetDate}`);
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailInput.fill(pilotOwnerEmail);
      await page.fill('input[type="password"]', pilotPassword);
      await page.click('button[type="submit"]');
      await expect(page.locator('h1')).toContainText('Календарь записей', { timeout: 15000 });
    }

    // Assert booking card is visible with exact public reference
    const bookingCard = page.locator(`[data-public-ref="${bookedPublicRef}"]`);
    await expect(bookingCard).toBeVisible({ timeout: 15000 });
    await expect(bookingCard).toContainText('Ерлан Мусин');
    await page.screenshot({ path: 'docs/screenshots/pilot-06-crm-calendar-synced.png', fullPage: true });
  });

  test('PR-5.5: Multi-Tenant Host Isolation (Pilot Tenant vs Modern Cut Control)', async ({ page, request }) => {
    expect(bookedPublicRef).toBeTruthy();

    // 1. Modern Cut owner logs into CRM
    await page.goto(CRM_URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.fill('input[type="email"]', 'owner@moderncut.kz');
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await expect(page.locator('h1')).toContainText('Календарь записей', { timeout: 15000 });
    await expect(page.locator('header')).toContainText(/modern cut/i);

    // 2. Strict Calendar Isolation: Modern Cut CANNOT see Pilot Tenant's booking card or customer
    await expect(page.locator(`[data-public-ref="${bookedPublicRef}"]`)).not.toBeVisible();
    await expect(page.locator('text=Ерлан Мусин')).not.toBeVisible();

    // 3. Direct API cross-tenant attempt: Modern Cut token attempting to fetch Pilot Tenant's site/customers
    const loginResp = await request.post(`${API_URL}/api/v1/auth/login`, {
      data: { email: 'owner@moderncut.kz', password: 'Password123!' },
    });
    expect(loginResp.ok()).toBeTruthy();
    const { access_token } = await loginResp.json();

    // Direct HTTP request to /api/v1/business/customers with cross-tenant header or query must not leak Pilot's customer
    const crossResp = await request.get(`${API_URL}/api/v1/business/customers?search=Ерлан`, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        'X-Tenant-ID': '4dce3056-a4a1-4f6a-9ce5-e04be389bb46', // Barberhouse/Pilot ID
      },
    });
    // Either 403 Forbidden or empty results under Modern Cut RLS context
    if (crossResp.ok()) {
      const customers = await crossResp.json();
      expect(customers.length).toBe(0);
    } else {
      expect([403, 404]).toContain(crossResp.status());
    }
  });

  test('PR-5.6: Support Request, Owner Approval & Revocation Lifecycle (FC-P1-01)', async ({ page, request }) => {
    // 1. Support Operator logs in to Platform Console and requests access
    await page.goto(PLATFORM_URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.click('[data-testid="quick-login-support"]');
    await page.click('[data-testid="platform-login-submit-btn"]');
    await expect(page.locator('[data-testid="platform-user-role-badge"]')).toContainText('поддержк');

    // Create Support Access Request
    await page.click('[data-testid="platform-nav-support"]');
    await page.click('[data-testid="tab-support-access"]');
    await page.click('[data-testid="request-access-open-modal-btn"]');
    await expect(page.locator('[data-testid="request-access-modal"]')).toBeVisible();

    await page.selectOption('[data-testid="access-tenant-select"]', { label: `${pilotName} (${pilotSlug})` });
    const uniqueReason = `Диагностика интеграции пилота ${runId}`;
    await page.fill('[data-testid="access-reason-input"]', uniqueReason);
    await page.click('[data-testid="confirm-request-access-btn"]');
    await expect(page.locator(`text=${uniqueReason}`).first()).toBeVisible({ timeout: 10000 });

    // 2. Pilot Tenant Owner logs into CRM Settings -> Security tab and approves support access
    const browser = page.context().browser();
    const ownerContext = await browser!.newContext();
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(CRM_URL);

    await ownerPage.fill('[data-testid="crm-login-email-input"]', pilotOwnerEmail);
    await ownerPage.fill('[data-testid="crm-login-password-input"]', pilotPassword);
    await ownerPage.click('[data-testid="crm-login-submit-btn"]');
    await expect(ownerPage.locator('h1')).toContainText('Календарь записей', { timeout: 15000 });

    await ownerPage.click('[data-testid="nav-settings"]');
    await ownerPage.click('[data-testid="settings-tab-security"]');
    await expect(ownerPage.locator('[data-testid="pending-support-requests-table"]')).toBeVisible();
    await expect(ownerPage.locator(`text=${uniqueReason}`).first()).toBeVisible({ timeout: 10000 });

    // Approve support request
    const approveBtn = ownerPage.locator('button:has-text("Одобрить")').first();
    await approveBtn.click();
    await expect(ownerPage.locator('[data-testid="active-session-badge"]')).toBeVisible({ timeout: 10000 });

    // Revoke support access immediately
    const revokeBtn = ownerPage.locator('[data-testid="revoke-support-session-btn"]').first();
    await revokeBtn.click();
    await expect(ownerPage.locator('[data-testid="active-session-badge"]')).not.toBeVisible({ timeout: 10000 });
    await expect(ownerPage.locator('[data-testid="no-active-support-sessions"]')).toBeVisible({ timeout: 10000 });
    await ownerContext.close();
  });

  test('PR-5.7: Responsive Mobile Viewport Integrity (320px, 390px, 1280px)', async ({ page }) => {
    // Test 320px on Booking Web
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`http://${pilotSlug}.localhost:3000`);
    await expect(page.locator('header')).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/pilot-07-mobile-320px-booking.png' });

    // Test 390px on Business CRM
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CRM_URL);
    await expect(page.locator('h1')).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/pilot-08-mobile-390px-crm.png' });

    // Test 1280px on Platform Console
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(PLATFORM_URL);
    await expect(page.locator('h1')).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/pilot-09-desktop-1280px-console.png' });
  });
});
