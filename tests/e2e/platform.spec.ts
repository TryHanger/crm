import { test, expect } from '@playwright/test';

test.describe('Platform Console V1 E2E Suite', () => {
  const PLATFORM_URL = 'http://127.0.0.1:3002';
  const API_URL = 'http://127.0.0.1:8000';

  test('P1: Platform Authentication & CRM User Rejection', async ({ page }) => {
    await page.goto(PLATFORM_URL);

    // Negative test: Try CRM user without platform staff role
    await page.fill('[data-testid="platform-login-email-input"]', 'owner@barberhouse.kz');
    await page.fill('[data-testid="platform-login-password-input"]', 'Password123!');
    await page.click('[data-testid="platform-login-submit-btn"]');

    // Should display rejection error
    await expect(page.locator('[data-testid="login-error-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-error-message"]')).toContainText(
      'У этой учётной записи нет прав доступа к Platform Console'
    );

    // Positive test: Login as Platform Owner
    await page.click('[data-testid="quick-login-owner"]');
    await page.click('[data-testid="platform-login-submit-btn"]');

    // Should reach Platform Overview with role badge
    await expect(page.locator('[data-testid="platform-user-role-badge"]')).toBeVisible();
    await expect(page.locator('[data-testid="platform-user-role-badge"]')).toContainText('Владелец платформы');
    await expect(page.locator('[data-testid="platform-sidebar"]')).toBeVisible();
  });

  test('P2: Overview KPIs, Non-MRR Disclaimer & Urgent Attention Items', async ({ page }) => {
    await page.goto(PLATFORM_URL);
    await page.click('[data-testid="quick-login-owner"]');
    await page.click('[data-testid="platform-login-submit-btn"]');

    // Check 4 KPI cards
    await expect(page.locator('[data-testid="kpi-total-tenants"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-active-subscriptions"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-suspended-tenants"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-total-revenue"]')).toBeVisible();

    // Check Non-MRR Disclaimer
    await expect(page.locator('[data-testid="non-mrr-disclaimer"]')).toBeVisible();
    await expect(page.locator('[data-testid="non-mrr-disclaimer"]')).toContainText('Сумма подтверждённых ручных оплат');

    // Check Attention Items
    await expect(page.locator('[data-testid="attention-block"]')).toBeVisible();

    // Capture screenshot platform-01-overview.png
    await page.screenshot({ path: 'docs/screenshots/platform-01-overview.png', fullPage: true });
  });

  test('P3: Companies Repertoire & 4-Step Onboarding Wizard', async ({ page }) => {
    await page.goto(PLATFORM_URL);
    await page.click('[data-testid="quick-login-owner"]');
    await page.click('[data-testid="platform-login-submit-btn"]');

    // Navigate to Companies
    await page.click('[data-testid="platform-nav-companies"]');
    await expect(page.locator('[data-testid="tenants-table"]')).toBeVisible();

    // Capture screenshot platform-02-companies-repertoire.png
    await page.screenshot({ path: 'docs/screenshots/platform-02-companies-repertoire.png', fullPage: true });

    // Filter by niche
    await page.selectOption('[data-testid="filter-vertical"]', 'barbershop');
    await page.waitForTimeout(400);

    // Launch Wizard
    await page.click('[data-testid="new-tenant-open-wizard-btn"]');
    await expect(page.locator('[data-testid="onboarding-wizard-modal"]')).toBeVisible();

    // Capture screenshot platform-04-onboarding-wizard.png
    await page.screenshot({ path: 'docs/screenshots/platform-04-onboarding-wizard.png' });

    // Step 1: Details
    const testSlug = `e2etest${Date.now().toString().slice(-4)}`;
    await page.fill('[data-testid="wizard-input-name"]', `E2E Studio ${testSlug}`);
    await page.fill('[data-testid="wizard-input-slug"]', testSlug);
    await page.click('[data-testid="wizard-step1-next-btn"]');

    // Step 2: Plan
    await page.click('[data-testid="wizard-plan-option-pro"]');
    await page.click('[data-testid="wizard-step2-next-btn"]');

    // Step 3: Owner
    await page.fill('[data-testid="wizard-input-owner-name"]', 'Тест Владелец');
    await page.fill('[data-testid="wizard-input-owner-email"]', `owner_${testSlug}@example.kz`);
    await page.click('[data-testid="wizard-finish-btn"]');

    // Step 4: Success with generated invite link
    await expect(page.locator('[data-testid="wizard-step4-success"]')).toBeVisible();
    await expect(page.locator('[data-testid="wizard-invite-url-display"]')).toBeVisible();
    const inviteUrl = await page.inputValue('[data-testid="wizard-invite-url-display"]');
    expect(inviteUrl).toContain('/accept-invite?token=');

    // Go to Tenant Detail Card
    await page.click('[data-testid="wizard-go-to-tenant-btn"]');
    await expect(page.locator('[data-testid="tenant-detail-view"]')).toBeVisible();
  });

  test('P4: Tenant Detail 7 Tabs, Entitlement Override & Lifecycle Suspension', async ({ page }) => {
    await page.goto(PLATFORM_URL);
    await page.click('[data-testid="quick-login-owner"]');
    await page.click('[data-testid="platform-login-submit-btn"]');

    await page.click('[data-testid="platform-nav-companies"]');
    await expect(page.locator('[data-testid="tenants-table"]')).toBeVisible();

    // Open Barber House
    await page.click('[data-testid="open-tenant-detail-barberhouse"]');
    await expect(page.locator('[data-testid="tenant-detail-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="tenant-detail-status-pill"]')).toContainText('Активна');

    // Capture screenshot platform-03-tenant-card-tabs.png
    await page.screenshot({ path: 'docs/screenshots/platform-03-tenant-card-tabs.png', fullPage: true });

    // Tab 1: Overview
    await page.click('[data-testid="tenant-tab-overview"]');
    await expect(page.locator('text=Активных филиалов')).toBeVisible();

    // Tab 2: Subscription
    await page.click('[data-testid="tenant-tab-subscription"]');
    await expect(page.locator('text=Текущий тариф')).toBeVisible();

    // Tab 3: Modules & Limits - Add Override
    await page.click('[data-testid="tenant-tab-entitlements"]');
    await page.click('[data-testid="add-override-open-modal-btn"]');
    await expect(page.locator('[data-testid="add-override-modal"]')).toBeVisible();
    await page.fill('[data-testid="override-value-input"]', '4');
    await page.fill('[data-testid="override-reason-input"]', 'Открытие дополнительного филиала по заявке #490');
    await page.click('[data-testid="confirm-save-override-btn"]');
    await expect(page.locator('text=Открытие дополнительного филиала по заявке #490').first()).toBeVisible();

    // Tab 4: Users & Access (FC-P0-01)
    await page.click('[data-testid="tenant-tab-users"]');
    await expect(page.locator('text=Пользователи с активным доступом')).toBeVisible();
    await expect(page.locator('[data-testid="tenant-members-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="tenant-members-table"]')).toContainText('owner@barberhouse.kz');
    await expect(page.locator('[data-testid="users-error-banner"]')).not.toBeVisible();
    // Re-capture platform-03-tenant-card-tabs.png with loaded members table (FC-P0-01)
    await page.screenshot({ path: 'docs/screenshots/platform-03-tenant-card-tabs.png', fullPage: true });

    // Tab 5: Domains
    await page.click('[data-testid="tenant-tab-domains"]');
    await expect(page.locator('text=barberhouse.book.example.kz').first()).toBeVisible();

    // Tab 6: Activity
    await page.click('[data-testid="tenant-tab-activity"]');
    await expect(page.locator('text=Журнал событий компании')).toBeVisible();

    // Tab 7: Support
    await page.click('[data-testid="tenant-tab-support"]');
    await expect(page.locator('[data-testid="tenant-open-support-tickets-btn"]')).toBeVisible();

    // Suspend company flow
    await page.click('[data-testid="tenant-suspend-open-modal-btn"]');
    await expect(page.locator('[data-testid="suspend-tenant-modal"]')).toBeVisible();
    await page.fill('[data-testid="suspend-reason-input"]', 'Плановые регламентные работы платформы');
    await page.click('[data-testid="confirm-suspend-tenant-btn"]');

    // Should now show suspended status banner and pill
    await expect(page.locator('[data-testid="tenant-detail-status-pill"]')).toContainText('Приостановлена');
    await expect(page.locator('[data-testid="tenant-suspended-banner"]')).toBeVisible();

    // Reactivate company flow
    await page.click('[data-testid="tenant-reactivate-open-modal-btn"]');
    await expect(page.locator('[data-testid="reactivate-tenant-modal"]')).toBeVisible();
    await page.fill('[data-testid="reactivate-reason-input"]', 'Регламентные работы завершены, доступ восстановлен');
    await page.click('[data-testid="confirm-reactivate-tenant-btn"]');

    // Restored to active
    await expect(page.locator('[data-testid="tenant-detail-status-pill"]')).toContainText('Активна');
  });

  test('P5: Subscriptions & Billing Ledger Manual Payment Recording', async ({ page }) => {
    await page.goto(PLATFORM_URL);
    await page.click('[data-testid="quick-login-finance"]');
    await page.click('[data-testid="platform-login-submit-btn"]');

    // Navigate to Subscriptions
    await page.click('[data-testid="platform-nav-subs"]');
    await expect(page.locator('[data-testid="subscriptions-table"]')).toBeVisible();

    // Renew subscription: default record_payment=false (extend access only)
    await page.click('[data-testid="renew-sub-btn-cutco"]');
    await expect(page.locator('[data-testid="renew-subscription-modal"]')).toBeVisible();
    await page.click('[data-testid="confirm-renew-submit-btn"]');
    await expect(page.locator('[data-testid="platform-toast"]')).toBeVisible();

    // Switch to Charges Ledger (ensure data loaded and non-empty!)
    await page.click('[data-testid="tab-charges"]');
    await expect(page.locator('[data-testid="charges-table"]')).toBeVisible();
    await expect(page.locator('button:has-text("Зафиксировать оплату")').first()).toBeVisible();

    // Capture screenshot platform-05-subscriptions-ledger.png with non-empty loaded ledger!
    await page.screenshot({ path: 'docs/screenshots/platform-05-subscriptions-ledger.png', fullPage: true });

    // Open Payment Modal for first charge
    await page.click('button:has-text("Зафиксировать оплату")');
    await expect(page.locator('[data-testid="record-payment-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="payment-idempotency-key"]')).toBeVisible();
    const pmtKey = await page.textContent('[data-testid="payment-idempotency-key"]');
    expect(pmtKey).toContain('pmt_');

    // Fill valid external evidence reference (no fabricated numbers!)
    await page.fill('[data-testid="payment-evidence-input"]', 'Kaspi Pay Чек №948201');
    await page.click('[data-testid="confirm-record-payment-btn"]');
    await expect(page.locator('[data-testid="platform-toast"]')).toBeVisible();
  });

  test('P6: Plans Catalog & Plan Versioning', async ({ page }) => {
    await page.goto(PLATFORM_URL);
    await page.click('[data-testid="quick-login-owner"]');
    await page.click('[data-testid="platform-login-submit-btn"]');

    await page.click('[data-testid="platform-nav-plans"]');
    await expect(page.locator('[data-testid="plans-grid"]')).toBeVisible();
    await expect(page.locator('[data-testid="plan-card-pro"]')).toBeVisible();

    // Capture screenshot platform-06-plans-catalog.png
    await page.screenshot({ path: 'docs/screenshots/platform-06-plans-catalog.png', fullPage: true });

    // Create new version for Pro plan
    await page.click('[data-testid="create-new-version-btn-pro"]');
    await expect(page.locator('[data-testid="create-version-modal"]')).toBeVisible();
    await page.fill('[data-testid="version-price-input"]', '22000');
    await page.click('[data-testid="confirm-create-version-btn"]');
    await expect(page.locator('[data-testid="platform-toast"]')).toBeVisible();

    // Navigate to Modules Catalog
    await page.click('[data-testid="platform-nav-modules"]');
    await expect(page.locator('[data-testid="modules-catalog-table"]')).toBeVisible();

    // Capture screenshot platform-07-modules-catalog.png
    await page.screenshot({ path: 'docs/screenshots/platform-07-modules-catalog.png', fullPage: true });
  });

  test('P7: Support Diagnosis & Real Owner-Approval Flow (P0-02)', async ({ page, request }) => {
    await page.goto(PLATFORM_URL);
    await page.click('[data-testid="quick-login-support"]');
    await page.click('[data-testid="platform-login-submit-btn"]');

    await page.click('[data-testid="platform-nav-support"]');
    await expect(page.locator('[data-testid="support-tickets-table"]')).toBeVisible();

    // Tab: Diagnosis (Loaded non-empty report with live healthy DB check)
    await page.click('[data-testid="tab-support-diagnosis"]');
    await expect(page.locator('[data-testid="diagnosis-report-card"]')).toBeVisible();
    await expect(page.locator('text=strict').first()).toBeVisible();

    // Capture screenshot platform-08-support-diagnosis-session.png with non-empty loaded report!
    await page.screenshot({ path: 'docs/screenshots/platform-08-support-diagnosis-session.png', fullPage: true });

    // Tab: Access Requests
    await page.click('[data-testid="tab-support-access"]');
    await page.click('[data-testid="request-access-open-modal-btn"]');
    await expect(page.locator('[data-testid="request-access-modal"]')).toBeVisible();
    await page.selectOption('[data-testid="access-tenant-select"]', { label: 'Barber House (barberhouse)' });
    const uniqueReason = `Обращение #1042: диагностика отправки SMS мастеру ${Date.now()}`;
    await page.fill('[data-testid="access-reason-input"]', uniqueReason);
    await page.click('[data-testid="confirm-request-access-btn"]');

    // Request created -> shows pending status with owner consent notice
    await expect(page.locator(`text=${uniqueReason}`).first()).toBeVisible();
    await expect(page.locator('text=Ожидает согласия владельца').first()).toBeVisible();

    // UNCONDITIONAL ASSERTION 1: Self-approval button is NOT rendered for support in Platform Console!
    await expect(page.locator('button:has-text("Одобрить (30 мин)")')).not.toBeVisible();

    // UNCONDITIONAL ASSERTION 2: Support direct API call to approve returns 403 Forbidden!
    const supportLogin = await request.post(`${API_URL}/api/v1/auth/login`, {
      data: { email: 'support@platform.example.kz', password: 'Password123!' },
    });
    const sToken = (await supportLogin.json()).access_token;
    const reqsRes = await request.get(`${API_URL}/api/v1/platform/access-requests`, {
      headers: { Authorization: `Bearer ${sToken}` },
    });
    const reqs = await reqsRes.json();
    const accessReq = reqs.find((r: any) => r.reason === uniqueReason);
    expect(accessReq).toBeTruthy();
    const reqId = accessReq.id;

    const selfApproveResp = await request.post(`${API_URL}/api/v1/platform/access-requests/${reqId}/approve`, {
      headers: { Authorization: `Bearer ${sToken}` },
    });
    expect(selfApproveResp.status()).toBe(403);

    // UNCONDITIONAL ASSERTION 3: Real browser interaction in Business CRM for Owner Approval (FC-P1-01)
    const browser = page.context().browser();
    const ownerContext = await browser!.newContext();
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto('http://127.0.0.1:3001');

    // Login as Barber House owner in Business CRM
    await ownerPage.fill('[data-testid="crm-login-email-input"]', 'owner@barberhouse.kz');
    await ownerPage.fill('[data-testid="crm-login-password-input"]', 'Password123!');
    await ownerPage.click('[data-testid="crm-login-submit-btn"]');

    // Navigate to Settings -> Security tab
    await ownerPage.click('[data-testid="nav-settings"]');
    await expect(ownerPage.locator('[data-testid="settings-tab-security"]')).toBeVisible();
    await ownerPage.click('[data-testid="settings-tab-security"]');

    // Pending requests table visible with uniqueReason
    await expect(ownerPage.locator('[data-testid="pending-support-requests-table"]')).toBeVisible();
    await expect(ownerPage.locator(`text=${uniqueReason}`).first()).toBeVisible();

    // Capture screenshot crm-17-owner-support-approval.png
    await ownerPage.screenshot({ path: 'docs/screenshots/crm-17-owner-support-approval.png', fullPage: true });

    // Owner approves support access via browser UI button
    await ownerPage.click(`[data-testid="approve-support-btn-${reqId}"]`);
    await expect(ownerPage.locator('[data-testid="active-support-sessions-section"]')).toBeVisible();
    await expect(ownerPage.locator('[data-testid="active-session-badge"]')).toBeVisible();
    await ownerContext.close();

    // Reload Platform Console: active support session banner appears!
    await page.reload();
    await expect(page.locator('[data-testid="active-support-session-banner"]')).toBeVisible();
    await expect(page.locator('[data-testid="active-support-session-banner"]')).toContainText('Диагностический доступ активен');

    // End / Revoke support session
    await page.click('[data-testid="end-support-session-btn"]');
    await expect(page.locator('[data-testid="active-support-session-banner"]')).not.toBeVisible();
  });

  test('P8: Audit Trail Diff & Platform Settings RBAC (P0-03)', async ({ page }) => {
    await page.goto(PLATFORM_URL);
    await page.click('[data-testid="quick-login-owner"]');
    await page.click('[data-testid="platform-login-submit-btn"]');

    // Check Audit Module
    await page.click('[data-testid="platform-nav-audit"]');
    await expect(page.locator('[data-testid="audit-table"]')).toBeVisible();

    // Capture screenshot platform-09-audit-trail-diff.png
    await page.screenshot({ path: 'docs/screenshots/platform-09-audit-trail-diff.png', fullPage: true });

    // Check Settings Module
    await page.click('[data-testid="platform-nav-settings"]');
    await expect(page.locator('[data-testid="platform-staff-table"]')).toBeVisible();

    // Test secure operator invitation without default password (P0-03)
    await page.click('[data-testid="add-staff-open-modal-btn"]');
    await expect(page.locator('[data-testid="add-staff-modal"]')).toBeVisible();
    // Default password input is NOT present
    await expect(page.locator('[data-testid="staff-password-input"]')).not.toBeVisible();
    await page.fill('[data-testid="staff-email-input"]', `test_sec_${Date.now()}@platform.example.kz`);
    await page.fill('[data-testid="staff-name-input"]', 'Оператор Безопасный');
    await page.click('[data-testid="confirm-add-staff-btn"]');

    // Activation URL modal opens with one-time link
    await expect(page.locator('[data-testid="activation-url-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="activation-url-display"]')).toBeVisible();
    const actUrl = await page.inputValue('[data-testid="activation-url-display"]');
    expect(actUrl).toContain('/activate-platform?token=');
    await page.click('[data-testid="close-activation-modal-btn"]');

    // Check RBAC Matrix tab
    await page.click('[data-testid="tab-settings-rbac"]');
    await expect(page.locator('[data-testid="rbac-matrix-card"]')).toBeVisible();

    // Capture screenshot platform-10-settings-rbac.png
    await page.screenshot({ path: 'docs/screenshots/platform-10-settings-rbac.png', fullPage: true });
  });

  test('P9: Role Restrictions Enforcement (Direct HTTP 403 checks)', async ({ page, request }) => {
    await page.goto(PLATFORM_URL);
    // Login as Viewer (read-only)
    await page.click('[data-testid="quick-login-viewer"]');
    await page.click('[data-testid="platform-login-submit-btn"]');

    // Navigate to Companies - Verify Suspend / Add Tenant buttons are hidden for Viewer
    await page.click('[data-testid="platform-nav-companies"]');
    await expect(page.locator('[data-testid="new-tenant-open-wizard-btn"]')).not.toBeVisible();

    // Direct HTTP 403 check for viewer attempting to suspend tenant
    const viewerLogin = await request.post(`${API_URL}/api/v1/auth/login`, {
      data: { email: 'viewer@platform.example.kz', password: 'Password123!' },
    });
    const vToken = (await viewerLogin.json()).access_token;
    const suspResp = await request.post(`${API_URL}/api/v1/platform/tenants/00000000-0000-0000-0000-000000000000/suspend`, {
      headers: { Authorization: `Bearer ${vToken}` },
      data: { reason: 'Unauthorized suspend' },
    });
    expect(suspResp.status()).toBe(403);

    // Direct HTTP 403 check for support attempting to record payment
    const supportLogin = await request.post(`${API_URL}/api/v1/auth/login`, {
      data: { email: 'support@platform.example.kz', password: 'Password123!' },
    });
    const sToken = (await supportLogin.json()).access_token;
    const pmtResp = await request.post(`${API_URL}/api/v1/platform/charges/00000000-0000-0000-0000-000000000000/record-payment`, {
      headers: { Authorization: `Bearer ${sToken}` },
      data: { amount_minor: 100000, evidence_reference: 'Fake' },
    });
    expect(pmtResp.status()).toBe(403);
  });

  test('P10: Responsive Mobile Viewport (390px) & Navigation (P0-05)', async ({ page }) => {
    // Set mobile viewport 390 x 844
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PLATFORM_URL);

    // Login as Platform Owner
    await page.click('[data-testid="quick-login-owner"]');
    await page.click('[data-testid="platform-login-submit-btn"]');

    // Mobile layout elements check:
    // Desktop sidebar must be hidden
    await expect(page.locator('.platform-desktop-sidebar')).toBeHidden();

    // Mobile top header and bottom navigation bar must be visible
    await expect(page.locator('.platform-mobile-header')).toBeVisible();
    await expect(page.locator('[data-testid="platform-user-role-badge-mobile"]')).toBeVisible();
    await expect(page.locator('[data-testid="platform-bottom-nav"]')).toBeVisible();

    // Verify page has no horizontal overflow: scrollWidth <= viewportWidth (390px)
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);

    // Capture screenshot platform-11-mobile-overview.png at 390px!
    await page.screenshot({ path: 'docs/screenshots/platform-11-mobile-overview.png' });

    // Test mobile bottom navigation to Companies
    await page.click('[data-testid="mobile-nav-companies"]');
    await expect(page.locator('[data-testid="tenants-table"]')).toBeVisible();

    // Test mobile bottom navigation to Subscriptions
    await page.click('[data-testid="mobile-nav-subs"]');
    await expect(page.locator('[data-testid="subscriptions-table"]')).toBeVisible();

    // Test mobile bottom navigation to Support
    await page.click('[data-testid="mobile-nav-support"]');
    await expect(page.locator('[data-testid="support-tickets-table"]')).toBeVisible();

    // Test mobile drawer (via "Ещё" button)
    await page.click('[data-testid="mobile-nav-more"]');
    await expect(page.locator('[data-testid="mobile-drawer"]')).toBeVisible();

    // Navigate to Plans via drawer
    await page.click('[data-testid="drawer-nav-plans"]');
    await expect(page.locator('[data-testid="plans-grid"]')).toBeVisible();

    // Test mobile logout
    await page.click('[data-testid="platform-mobile-logout-btn"]');
    await expect(page.locator('[data-testid="platform-login-submit-btn"]')).toBeVisible();
  });
test('P11: Operator Activation Page UI Flow (FC-P0-02)', async ({ page }) => {
    // 1. Platform Owner invites new operator staff
    await page.goto(PLATFORM_URL);
    await page.click('[data-testid="quick-login-owner"]');
    await page.click('[data-testid="platform-login-submit-btn"]');
    await page.click('[data-testid="platform-nav-settings"]');
    await expect(page.locator('[data-testid="platform-staff-table"]')).toBeVisible();

    await page.click('[data-testid="add-staff-open-modal-btn"]');
    await expect(page.locator('[data-testid="add-staff-modal"]')).toBeVisible();
    const testStaffEmail = `op_act_${Date.now()}@platform.example.kz`;
    await page.fill('[data-testid="staff-email-input"]', testStaffEmail);
    await page.fill('[data-testid="staff-name-input"]', 'Оператор Активации');
    await page.click('[data-testid="confirm-add-staff-btn"]');

    // 2. Obtain absolute activation link
    await expect(page.locator('[data-testid="activation-url-modal"]')).toBeVisible();
    const actUrl = await page.inputValue('[data-testid="activation-url-display"]');
    expect(actUrl).toContain('/activate-platform?token=');
    await page.click('[data-testid="close-activation-modal-btn"]');

    // Logout from owner session
    await page.click('[data-testid="platform-logout-btn"]');
    await expect(page.locator('[data-testid="platform-login-submit-btn"]')).toBeVisible();

    // 3. Open activation page via URL
    await page.goto(actUrl);
    await expect(page.locator('[data-testid="operator-activation-page"]')).toBeVisible();

    // Capture screenshot platform-12-operator-activation.png
    await page.screenshot({ path: 'docs/screenshots/platform-12-operator-activation.png', fullPage: true });

    // 4. Fill password mismatch -> displays error
    await page.fill('[data-testid="activation-password-input"]', 'SecurePass2026!');
    await page.fill('[data-testid="activation-confirm-password-input"]', 'MismatchPass999!');
    await page.click('[data-testid="activation-submit-btn"]');
    await expect(page.locator('[data-testid="activation-error"]')).toContainText('Пароли не совпадают');

    // 5. Fill matching secure password -> submit
    await page.fill('[data-testid="activation-confirm-password-input"]', 'SecurePass2026!');
    await page.click('[data-testid="activation-submit-btn"]');

    // 6. Verify activation success
    await expect(page.locator('[data-testid="activation-success"]')).toBeVisible();
    await page.click('[data-testid="go-to-login-btn"]');

    // 7. Login with newly activated credentials
    await page.fill('[data-testid="platform-login-email-input"]', testStaffEmail);
    await page.fill('[data-testid="platform-login-password-input"]', 'SecurePass2026!');
    await page.click('[data-testid="platform-login-submit-btn"]');
    await expect(page.locator('[data-testid="platform-user-role-badge"]')).toBeVisible();
    await expect(page.locator('[data-testid="platform-user-role-badge"]')).toContainText('Аналитик / Наблюдатель');

    // 8. Re-opening consumed token and attempting activation again shows error (409 / already consumed)
    await page.goto(actUrl);
    await expect(page.locator('[data-testid="operator-activation-page"]')).toBeVisible();
    await page.fill('[data-testid="activation-password-input"]', 'AnotherPass123!');
    await page.fill('[data-testid="activation-confirm-password-input"]', 'AnotherPass123!');
    await page.click('[data-testid="activation-submit-btn"]');
    await expect(page.locator('[data-testid="activation-error"]')).toBeVisible();

    // 9. Verify sensitive token is never stored in localStorage
    const localActivationToken = await page.evaluate(() => localStorage.getItem('activation_token') || localStorage.getItem('token'));
    expect(localActivationToken).toBeNull();
  });
});
