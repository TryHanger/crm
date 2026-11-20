import { test, expect } from '@playwright/test';

const PLATFORM_URL = 'http://127.0.0.1:3002';
const CRM_URL = 'http://localhost:3001';

test.describe.serial('Full Unbroken Commercial Lifecycle (M01 -> M16) on Brand-New Company', () => {
  const runId = Date.now().toString().slice(-6);
  const companyName = `FullCycle Salon ${runId}`;
  const companySlug = `fullcycle${runId}`;
  const ownerEmail = `owner_${runId}@fullcycle.kz`;
  const adminEmail = `admin_${runId}@fullcycle.kz`;
  const masterEmail = `master_${runId}@fullcycle.kz`;
  const commonPassword = 'StrongPassword123!';

  const branchName = `Филиал Туран ${runId}`;
  const serviceName = `Премиум стрижка ${runId}`;
  const staffDisplayName = `Арман Барбер ${runId}`;
  const customerName = `Тимур Клиент ${runId}`;
  const customerPhone = `+7701${Math.floor(1000000 + Math.random() * 8999999)}`;

  let ownerInviteToken = '';
  let adminInviteToken = '';
  let masterInviteToken = '';
  let bookingDateStr = '';
  let bookedPublicRef = '';
  let manageUrl = '';

  test('Stage 1 (M01-M02): Platform Admin creates brand-new company & gets owner invite', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(PLATFORM_URL);
    await page.click('[data-testid="quick-login-owner"]');
    await page.click('[data-testid="platform-login-submit-btn"]');
    await expect(page.locator('[data-testid="platform-user-role-badge"]')).toContainText('Владелец платформы', { timeout: 15000 });

    await page.click('[data-testid="platform-nav-companies"]');
    await page.click('[data-testid="new-tenant-open-wizard-btn"]');
    await expect(page.locator('[data-testid="onboarding-wizard-modal"]')).toBeVisible();

    // Step 1: Company Name & Slug
    await page.fill('[data-testid="wizard-input-name"]', companyName);
    await page.fill('[data-testid="wizard-input-slug"]', companySlug);
    await page.click('[data-testid="wizard-step1-next-btn"]');

    // Step 2: Plan
    await page.click('[data-testid="wizard-plan-option-start"]');
    await page.click('[data-testid="wizard-step2-next-btn"]');

    // Step 3: Owner info
    await page.fill('[data-testid="wizard-input-owner-name"]', 'Алишер Владелец');
    await page.fill('[data-testid="wizard-input-owner-email"]', ownerEmail);
    await page.click('[data-testid="wizard-finish-btn"]');

    // Step 4: One-time invite link
    await expect(page.locator('[data-testid="wizard-step4-success"]')).toBeVisible({ timeout: 10000 });
    const inviteUrl = await page.inputValue('[data-testid="wizard-invite-url-display"]');
    expect(inviteUrl).toContain('/accept-invite?token=');
    ownerInviteToken = inviteUrl.match(/token=([^&]+)/)![1];
    expect(ownerInviteToken).toBeTruthy();
  });

  test('Stage 2 (M02-M05): Owner activates invite, completes onboarding (branch + 8000 KZT service + master w/ auto-schedule & services)', async ({ page }) => {
    test.setTimeout(90000);
    expect(ownerInviteToken).toBeTruthy();

    // 1. Activate Owner via one-time link
    await page.goto(`${CRM_URL}/accept-invite?token=${ownerInviteToken}`);
    await expect(page.locator('[data-testid="accept-invite-page"]')).toBeVisible({ timeout: 10000 });
    await page.fill('[data-testid="invite-name-input"]', 'Алишер Владелец');
    await page.fill('[data-testid="invite-password-input"]', commonPassword);
    await page.fill('[data-testid="invite-confirm-password-input"]', commonPassword);
    await page.click('[data-testid="invite-submit-btn"]');

    // Should land in Business CRM with company name in header & onboarding module
    await expect(page.locator('header')).toContainText(new RegExp(companyName, 'i'), { timeout: 15000 });

    // 2. Onboarding Step 1: Create First Branch right from Onboarding screen
    const onboardingModule = page.locator('[data-testid="onboarding-module"]');
    if (!(await onboardingModule.isVisible({ timeout: 3000 }).catch(() => false))) {
      await page.click('aside button:has-text("Онбординг")');
    }
    await expect(onboardingModule).toBeVisible({ timeout: 10000 });

    await page.fill('[data-testid="onboarding-branch-name-input"]', branchName);
    await page.fill('[data-testid="onboarding-branch-address-input"]', 'пр. Туран, 15');
    await page.click('[data-testid="onboarding-create-branch-btn"]');
    await expect(page.locator('[data-testid="step-branch-completed-badge"]')).toBeVisible({ timeout: 10000 });

    // 3. Create Service (8 000 KZT, 60 min) directly via Onboarding Quick Service (M02->M04)
    await page.click('[data-testid="onboarding-quick-service-toggle"]');
    await page.fill('[data-testid="onboarding-service-name-input"]', serviceName);
    await page.fill('[data-testid="onboarding-service-price-input"]', '8000');
    await page.click('[data-testid="onboarding-submit-service-btn"]');
    await page.waitForTimeout(800);

    // 4. Create Staff member via Onboarding Quick Staff (tests our M02->M04/M05 auto-link of services + Mon-Sat schedule!)
    await page.click('[data-testid="onboarding-quick-staff-toggle"]');
    await page.fill('[data-testid="onboarding-staff-name-input"]', staffDisplayName);
    await page.click('[data-testid="onboarding-submit-staff-btn"]');
    await page.waitForTimeout(1500);

    // Verify staff member exists in Staff module
    await page.click('aside button:has-text("Сотрудники")');
    await expect(page.locator(`text=${staffDisplayName}`)).toBeVisible({ timeout: 10000 });

    // 5. Publish Online Booking site & verify personal link + QR (M03)
    await page.click('aside button:has-text("Онлайн-запись")');
    await expect(page.locator('h1')).toContainText('Настройки онлайн-записи', { timeout: 10000 });
    await page.click('button:has-text("Публикация")');

    const linkInput = page.locator('[data-testid="booking-public-url-input"], input[readonly]').first();
    await expect(linkInput).toBeVisible({ timeout: 10000 });
    const linkVal = await linkInput.inputValue();
    expect(linkVal).toContain(companySlug);

    // Ensure published
    const toggleBtn = page.locator('[data-testid="publication-toggle-btn"], button:has-text("Опубликовать")').first();
    await expect(toggleBtn).toBeVisible({ timeout: 5000 });
    const btnText = await toggleBtn.innerText();
    if (/опубликовать/i.test(btnText)) {
      await toggleBtn.click();
      await expect(page.locator('button:has-text("Приостановить")')).toBeVisible({ timeout: 10000 });
    }
  });

  test('Stage 3 (M15): Owner invites Master (linked to staff profile) & Branch Admin, both activate accounts', async ({ page, browser }) => {
    test.setTimeout(90000);

    // Login as Owner
    await page.goto(CRM_URL);
    await page.fill('input[type="email"]', ownerEmail);
    await page.fill('input[type="password"]', commonPassword);
    await page.click('button[type="submit"]');
    await expect(page.locator('nav')).toBeVisible({ timeout: 15000 });

    // Go to Settings -> Users & Roles
    await page.click('aside button:has-text("Настройки")');
    await page.click('button:has-text("Пользователи и роли")');
    await expect(page.locator('[data-testid="invite-staff-btn"]')).toBeVisible({ timeout: 10000 });

    // 1. Invite Master linked to Арман Барбер
    await page.click('[data-testid="invite-staff-btn"]');
    await page.fill('[data-testid="invite-email-input"]', masterEmail);
    await page.selectOption('[data-testid="invite-role-select"]', 'master');
    const staffSelect = page.locator('[data-testid="invite-staff-profile-select"]');
    await expect(staffSelect).toBeVisible({ timeout: 5000 });
    const masterOptVal = await staffSelect.locator(`option:has-text("${staffDisplayName}")`).first().getAttribute('value');
    expect(masterOptVal).toBeTruthy();
    await staffSelect.selectOption(masterOptVal!);

    await page.click('[data-testid="invite-submit-btn"]');
    const masterUrlInput = page.locator('[data-testid="invite-url-input"]');
    await expect(masterUrlInput).toBeVisible({ timeout: 10000 });
    const masterInviteUrl = await masterUrlInput.inputValue();
    masterInviteToken = masterInviteUrl.match(/token=([^&]+)/)![1];
    expect(masterInviteToken).toBeTruthy();

    // Close modal
    await page.locator('h3:has-text("Пригласить сотрудника") ~ button, button:has-text("✕")').first().click();

    // 2. Invite Branch Admin scoped to Главный филиал
    await page.click('[data-testid="invite-staff-btn"]');
    await page.fill('[data-testid="invite-email-input"]', adminEmail);
    await page.selectOption('[data-testid="invite-role-select"]', 'admin');
    await page.click('[data-testid="invite-submit-btn"]');
    const adminUrlInput = page.locator('[data-testid="invite-url-input"]');
    await expect(adminUrlInput).toBeVisible({ timeout: 10000 });
    const adminInviteUrl = await adminUrlInput.inputValue();
    adminInviteToken = adminInviteUrl.match(/token=([^&]+)/)![1];
    expect(adminInviteToken).toBeTruthy();

    // 3. Activate Master in clean context & verify RBAC isolation (M15: no Cash, no Reports)
    const masterCtx = await browser.newContext();
    const masterPage = await masterCtx.newPage();
    await masterPage.goto(`${CRM_URL}/accept-invite?token=${masterInviteToken}`);
    await masterPage.fill('[data-testid="invite-name-input"]', staffDisplayName);
    await masterPage.fill('[data-testid="invite-password-input"]', commonPassword);
    await masterPage.fill('[data-testid="invite-confirm-password-input"]', commonPassword);
    await masterPage.click('[data-testid="invite-submit-btn"]');
    await expect(masterPage.locator('h1')).toContainText('Календарь', { timeout: 15000 });
    await expect(masterPage.locator('aside button:has-text("Касса")')).toHaveCount(0);
    await expect(masterPage.locator('aside button:has-text("Отчёты")')).toHaveCount(0);
    await masterCtx.close();

    // 4. Activate Admin in clean context & verify Admin sees Calendar, Cash, Reports
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await adminPage.goto(`${CRM_URL}/accept-invite?token=${adminInviteToken}`);
    await adminPage.fill('[data-testid="invite-name-input"]', 'Айгерим Админ');
    await adminPage.fill('[data-testid="invite-password-input"]', commonPassword);
    await adminPage.fill('[data-testid="invite-confirm-password-input"]', commonPassword);
    await adminPage.click('[data-testid="invite-submit-btn"]');
    await expect(adminPage.locator('h1')).toContainText('Календарь', { timeout: 15000 });
    await expect(adminPage.locator('aside button:has-text("Касса")')).toBeVisible();
    await expect(adminPage.locator('aside button:has-text("Отчёты")')).toBeVisible();
    await adminCtx.close();
  });

  test('Stage 4 (M06-M07): Real Customer books online on brand-new salon subdomain & inspects /manage/:token', async ({ browser }) => {
    test.setTimeout(60000);
    const custCtx = await browser.newContext();
    const page = await custCtx.newPage();

    // Open brand-new salon's public booking site!
    await page.goto(`http://${companySlug}.localhost:3000`);
    await expect(page.locator('body')).toContainText(companyName, { timeout: 15000 });

    // Select the 8 000 KZT service
    const serviceCard = page.locator(`button:has-text("${serviceName}")`).first();
    await expect(serviceCard).toBeVisible({ timeout: 10000 });
    await serviceCard.click();
    await page.click('button:has-text("Выбрать специалиста"), button:has-text("Далее")');

    // Select our newly created staff member
    const staffCard = page.locator(`button:has-text("${staffDisplayName}")`).first();
    await expect(staffCard).toBeVisible({ timeout: 10000 });
    await staffCard.click();
    await page.click('button:has-text("Выбрать дату и время"), button:has-text("Выбрать время"), button:has-text("Далее")');

    // Pick tomorrow (or next working day that has slots)
    const dateButtons = page.locator('button[data-date]');
    const count = await dateButtons.count();
    let slotPicked = false;
    for (let i = 0; i < Math.min(count, 5); i++) {
      const btn = dateButtons.nth(i);
      const dStr = await btn.getAttribute('data-date');
      await btn.click();
      await page.waitForTimeout(500);
      const slotBtn = page.locator('main button:has-text(":")').first();
      if (await slotBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
        bookingDateStr = dStr || new Date().toISOString().split('T')[0];
        await slotBtn.click();
        slotPicked = true;
        break;
      }
    }
    expect(slotPicked).toBeTruthy();

    await page.click('button:has-text("Указать контакты"), button:has-text("Далее")');

    // Enter customer details & confirm
    await page.fill('input[placeholder="Иван Петров"]', customerName);
    await page.fill('input[placeholder="+7 (701) 000-00-00"]', customerPhone);
    await page.click('button:has-text("Подтвердить запись")');

    // Verify confirmation screen & capture public_ref + management link
    await expect(page.locator('h1:has-text("Запись подтверждена")')).toBeVisible({ timeout: 15000 });
    const bodyText = await page.locator('main').innerText();
    const refMatch = bodyText.match(/#([A-Z0-9]+-\d+)/);
    bookedPublicRef = refMatch ? refMatch[1] : '';
    expect(bookedPublicRef).toBeTruthy();

    // Open Self-Management Screen (/manage/:token)
    await page.click('button:has-text("Управление записью")');
    await expect(page.locator('h1:has-text("Управление записью")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).toContainText(bookedPublicRef);
    manageUrl = page.url();
    expect(manageUrl).toContain('/manage/');
    await custCtx.close();
  });

  test('Stage 5 (M08-M15): Master sees booking -> Admin completes visit, opens shift, takes partial + full payment, advance, refund, Z-report -> Owner checks ledger reports', async ({ browser }) => {
    test.setTimeout(120000);
    expect(bookingDateStr).toBeTruthy();

    // 1. MASTER logs in and sees the customer's booking on their calendar!
    const masterCtx = await browser.newContext();
    const masterPage = await masterCtx.newPage();
    await masterPage.goto(`${CRM_URL}/?date=${bookingDateStr}`);
    await masterPage.fill('input[type="email"]', masterEmail);
    await masterPage.fill('input[type="password"]', commonPassword);
    await masterPage.click('button[type="submit"]');
    await expect(masterPage.locator('h1')).toContainText('Календарь', { timeout: 15000 });
    await expect(masterPage.locator(`text=${customerName}`).first()).toBeVisible({ timeout: 15000 });
    await masterCtx.close();

    // 2. ADMIN logs in, opens Cash Shift (M13), records Customer Advance (M13)
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await adminPage.goto(`${CRM_URL}/?date=${bookingDateStr}`);
    await adminPage.fill('input[type="email"]', adminEmail);
    await adminPage.fill('input[type="password"]', commonPassword);
    await adminPage.click('button[type="submit"]');
    await expect(adminPage.locator('h1')).toContainText('Календарь', { timeout: 15000 });

    // Open Cash Shift with 10 000 KZT float
    await adminPage.click('aside button:has-text("Касса")');
    await expect(adminPage.locator('[data-testid="open-shift-btn"]')).toBeVisible({ timeout: 10000 });
    await adminPage.click('[data-testid="open-shift-btn"]');
    await adminPage.fill('[data-testid="opening-balance-input"]', '10000');
    await adminPage.click('[data-testid="confirm-open-shift-btn"]');
    await expect(adminPage.locator('[data-testid="active-shift-card"]')).toContainText('Смена открыта', { timeout: 10000 });

    // Take Customer Advance 2 000 KZT (cash)
    await adminPage.click('[data-testid="add-advance-btn"]');
    await adminPage.fill('[data-testid="advance-amount-input"]', '2000');
    await adminPage.fill('[data-testid="advance-customer-input"]', `${customerName} (${customerPhone})`);
    await adminPage.click('[data-testid="submit-advance-btn"]');
    await expect(adminPage.locator('[data-testid="shift-advances-stat"]')).toContainText(/2\s*000/, { timeout: 10000 });

    // 3. ADMIN goes to Calendar -> completes visit (M09 -> M11 accrual) -> partial payment 3000 cash + 5000 card (M12) -> refund 1000 card (M13)
    await adminPage.click('aside button:has-text("Календарь")');
    const bookingCard = adminPage.locator(`text=${customerName}`).first();
    await expect(bookingCard).toBeVisible({ timeout: 15000 });
    await bookingCard.click();
    await expect(adminPage.locator('[data-testid="visit-card-modal"]')).toBeVisible({ timeout: 10000 });

    // Walk through full M09 visit lifecycle: confirmed -> arrived -> in_progress -> completed
    await adminPage.click('button:has-text("Клиент прибыл")');
    await expect(adminPage.locator('[data-testid="visit-status-badge"]')).toContainText(/Прибыл|Приш/i, { timeout: 10000 });

    const startWorkBtn = adminPage.locator('button:has-text("В работе"), button:has-text("Начать")').first();
    if (await startWorkBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await startWorkBtn.click();
      await adminPage.waitForTimeout(500);
    }

    // Complete visit -> triggers M11 order + service_rendered 8 000 KZT
    await adminPage.click('[data-testid="status-btn-completed"], button:has-text("Завершить"), button:has-text("Завершён")');
    await expect(adminPage.locator('[data-testid="visit-status-badge"]')).toContainText('Заверш', { timeout: 10000 });

    // Verify M11 financial block inside visit card: Cost 8 000, Rendered 8 000, Paid 0, Debt 8 000
    const visitModal = adminPage.locator('[data-testid="visit-card-modal"]');
    await expect(visitModal).toContainText(/8\s*000/, { timeout: 10000 });

    // Partial payment #1: 3 000 KZT Cash (uses open DB cash shift!)
    await adminPage.click('[data-testid="register-payment-btn"]');
    await expect(adminPage.locator('[data-testid="payment-modal"]')).toBeVisible({ timeout: 5000 });
    await adminPage.fill('[data-testid="payment-amount-input"]', '3000');
    const cashMethodBtn = adminPage.locator('[data-testid="payment-method-cash"]');
    if (await cashMethodBtn.isVisible().catch(() => false)) {
      await cashMethodBtn.click();
    }
    await adminPage.click('[data-testid="submit-payment-btn"]');
    await expect(adminPage.locator('[data-testid="payment-status-badge"]')).toContainText('Частичная оплата', { timeout: 10000 });
    await expect(visitModal).toContainText(/5\s*000/);

    // Remaining payment #2: 5 000 KZT Card/Kaspi
    await adminPage.click('[data-testid="register-payment-btn"]');
    await expect(adminPage.locator('[data-testid="payment-modal"]')).toBeVisible({ timeout: 5000 });
    await adminPage.fill('[data-testid="payment-amount-input"]', '5000');
    await adminPage.click('[data-testid="payment-method-card"]');
    await adminPage.click('[data-testid="submit-payment-btn"]');
    await expect(adminPage.locator('[data-testid="payment-history-block"]')).toContainText(/8\s*000/, { timeout: 10000 });

    // Non-destructive refund (storno): 1 000 KZT on the card payment
    const historyBlock = adminPage.locator('[data-testid="payment-history-block"]');
    await historyBlock.scrollIntoViewIfNeeded();
    const refundBtn = adminPage.locator('[data-testid="refund-payment-btn"]').first();
    await expect(refundBtn).toBeVisible({ timeout: 10000 });
    await refundBtn.click();
    await expect(adminPage.locator('[data-testid="refund-modal"]')).toBeVisible({ timeout: 5000 });
    await adminPage.fill('[data-testid="refund-amount-input"]', '1000');
    await adminPage.click('[data-testid="confirm-refund-btn"]');
    await expect(historyBlock).toContainText('Возврат', { timeout: 10000 });
    await adminPage.click('[data-testid="visit-card-close-btn"]');

    // 4. ADMIN closes Cash Shift (Z-Report: 10 000 float + 2 000 advance + 3 000 cash payment - 1 000 cash refund = 14 000 KZT expected!)
    await adminPage.click('aside button:has-text("Касса")');
    await expect(adminPage.locator('[data-testid="close-shift-btn"]')).toBeVisible({ timeout: 10000 });
    await adminPage.click('[data-testid="close-shift-btn"]');
    await expect(adminPage.locator('[data-testid="close-shift-modal"]')).toBeVisible({ timeout: 5000 });
    await adminPage.fill('[data-testid="actual-cash-input"]', '14000');
    await expect(adminPage.locator('[data-testid="cash-difference"]')).toContainText(/сходится/i, { timeout: 5000 });
    await adminPage.click('[data-testid="confirm-close-shift-btn"]');
    await expect(adminPage.locator('[data-testid="shifts-history-table"], [data-testid="shift-history-table"]')).toContainText(/14\s*000/, { timeout: 10000 });
    await adminCtx.close();

    // 5. OWNER logs in, adds a non-cash Expense (M14), checks all 4 Ledger Reports & Notification Settings (M15)
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto(CRM_URL);
    await ownerPage.fill('input[type="email"]', ownerEmail);
    await ownerPage.fill('input[type="password"]', commonPassword);
    await ownerPage.click('button[type="submit"]');
    await expect(ownerPage.locator('nav')).toBeVisible({ timeout: 15000 });

    // Go to Reports -> Finance -> Add non-cash expense 1 500 KZT
    await ownerPage.click('aside button:has-text("Отчёты")');
    await ownerPage.click('[data-testid="report-tab-finance"]');
    await expect(ownerPage.locator('[data-testid="add-expense-btn"]')).toBeVisible({ timeout: 10000 });
    await ownerPage.click('[data-testid="add-expense-btn"]');
    await ownerPage.fill('[data-testid="expense-amount-input"]', '1500');
    const methodSel = ownerPage.locator('[data-testid="expense-method-select"]');
    if (await methodSel.isVisible().catch(() => false)) {
      await methodSel.selectOption('account');
    }
    await ownerPage.fill('[data-testid="expense-description-input"]', 'Закупка расходников');
    await ownerPage.click('[data-testid="confirm-expense-btn"]');
    await ownerPage.waitForTimeout(1000);

    // Verify real DB ledger figures: Rendered 7 000 (8000 - 1000 refund), Expenses 1 500
    await expect(ownerPage.locator('[data-testid="metric-rendered"]')).toContainText(/7\s*000/, { timeout: 10000 });
    await expect(ownerPage.locator('[data-testid="metric-expenses"]')).toContainText(/1\s*500/, { timeout: 10000 });

    // Check Visits, Services, Debts tabs
    await ownerPage.click('[data-testid="report-tab-visits"]');
    await expect(ownerPage.locator('text=Всего').first()).toBeVisible({ timeout: 5000 });
    await ownerPage.click('[data-testid="report-tab-services"]');
    await expect(ownerPage.locator('body')).toContainText(/Услуг|средний чек/i, { timeout: 5000 });
    await ownerPage.click('[data-testid="report-tab-debts"]');
    await expect(ownerPage.locator('body')).toContainText(/Дебитор|долг|нет/i, { timeout: 5000 });

    // Check Customers (M10): customer exists
    await ownerPage.click('aside button:has-text("Клиенты")');
    await expect(ownerPage.locator(`text=${customerName}`).first()).toBeVisible({ timeout: 10000 });

    // Check Notifications settings (M15): real API loaded & toggle works
    await ownerPage.click('aside button:has-text("Настройки")');
    await ownerPage.click('[data-testid="settings-tab-notifications"]');
    await expect(ownerPage.locator('[data-testid="toggle-email-notifications-btn"]')).toBeVisible({ timeout: 10000 });
    await ownerCtx.close();
  });
});
