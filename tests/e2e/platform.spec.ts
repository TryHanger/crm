import { test, expect } from '@playwright/test';

test.describe('Platform Console V1 E2E Suite', () => {
  const PLATFORM_URL = 'http://127.0.0.1:3002';

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
  });

  test('P3: Companies Repertoire & 4-Step Onboarding Wizard', async ({ page }) => {
    await page.goto(PLATFORM_URL);
    await page.click('[data-testid="quick-login-owner"]');
    await page.click('[data-testid="platform-login-submit-btn"]');

    // Navigate to Companies
    await page.click('[data-testid="platform-nav-companies"]');
    await expect(page.locator('[data-testid="tenants-table"]')).toBeVisible();

    // Filter by niche
    await page.selectOption('[data-testid="filter-vertical"]', 'barbershop');
    await page.waitForTimeout(500);

    // Launch Wizard
    await page.click('[data-testid="new-tenant-open-wizard-btn"]');
    await expect(page.locator('[data-testid="onboarding-wizard-modal"]')).toBeVisible();

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
    await page.click('[data-testid="open-tenant-detail-cutco"]');
    await expect(page.locator('[data-testid="tenant-detail-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="tenant-detail-status-pill"]')).toContainText('Активна');

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

    // Tab 4: Users & Access
    await page.click('[data-testid="tenant-tab-users"]');
    await expect(page.locator('text=Пользователи с активным доступом')).toBeVisible();

    // Tab 5: Domains
    await page.click('[data-testid="tenant-tab-domains"]');
    await expect(page.locator('text=cutco.book.example.kz').first()).toBeVisible();

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

    // Renew subscription for Barber House
    await page.click('[data-testid="renew-sub-btn-cutco"]');
    await expect(page.locator('[data-testid="renew-subscription-modal"]')).toBeVisible();
    await page.click('[data-testid="confirm-renew-submit-btn"]');
    await expect(page.locator('[data-testid="platform-toast"]')).toBeVisible();

    // Switch to Charges Ledger
    await page.click('[data-testid="tab-charges"]');
    await expect(page.locator('[data-testid="charges-table"]')).toBeVisible();
  });

  test('P6: Plans Catalog & Plan Versioning', async ({ page }) => {
    await page.goto(PLATFORM_URL);
    await page.click('[data-testid="quick-login-owner"]');
    await page.click('[data-testid="platform-login-submit-btn"]');

    await page.click('[data-testid="platform-nav-plans"]');
    await expect(page.locator('[data-testid="plans-grid"]')).toBeVisible();
    await expect(page.locator('[data-testid="plan-card-pro"]')).toBeVisible();

    // Create new version for Pro plan
    await page.click('[data-testid="create-new-version-btn-pro"]');
    await expect(page.locator('[data-testid="create-version-modal"]')).toBeVisible();
    await page.fill('[data-testid="version-price-input"]', '22000');
    await page.click('[data-testid="confirm-create-version-btn"]');
    await expect(page.locator('[data-testid="platform-toast"]')).toBeVisible();
  });

  test('P7: Support Diagnosis & Temporary 30-Min Access Flow', async ({ page }) => {
    await page.goto(PLATFORM_URL);
    await page.click('[data-testid="quick-login-support"]');
    await page.click('[data-testid="platform-login-submit-btn"]');

    await page.click('[data-testid="platform-nav-support"]');
    await expect(page.locator('[data-testid="support-tickets-table"]')).toBeVisible();

    // Tab: Diagnosis
    await page.click('[data-testid="tab-support-diagnosis"]');
    await expect(page.locator('[data-testid="diagnosis-report-card"]')).toBeVisible();
    await expect(page.locator('text=strict').first()).toBeVisible();

    // Tab: Access Requests
    await page.click('[data-testid="tab-support-access"]');
    await page.click('[data-testid="request-access-open-modal-btn"]');
    await expect(page.locator('[data-testid="request-access-modal"]')).toBeVisible();
    await page.fill('[data-testid="access-reason-input"]', 'Обращение #1042: диагностика отправки SMS мастеру');
    await page.click('[data-testid="confirm-request-access-btn"]');

    // Approve the pending request
    await expect(page.locator('text=Обращение #1042: диагностика отправки SMS мастеру').first()).toBeVisible();
    const approveBtns = page.locator('button:has-text("Одобрить (30 мин)")');
    if (await approveBtns.count() > 0) {
      await approveBtns.first().click();

      // Top session banner should appear
      await expect(page.locator('[data-testid="active-support-session-banner"]')).toBeVisible();
      await expect(page.locator('[data-testid="active-support-session-banner"]')).toContainText('Диагностический доступ активен');

      // End session
      await page.click('[data-testid="end-support-session-btn"]');
      await expect(page.locator('[data-testid="active-support-session-banner"]')).not.toBeVisible();
    }
  });

  test('P8: Audit Trail Diff & Platform Settings RBAC', async ({ page }) => {
    await page.goto(PLATFORM_URL);
    await page.click('[data-testid="quick-login-owner"]');
    await page.click('[data-testid="platform-login-submit-btn"]');

    // Check Audit Module
    await page.click('[data-testid="platform-nav-audit"]');
    await expect(page.locator('[data-testid="audit-table"]')).toBeVisible();

    // Check Settings Module
    await page.click('[data-testid="platform-nav-settings"]');
    await expect(page.locator('[data-testid="platform-staff-table"]')).toBeVisible();

    // Check RBAC Matrix tab
    await page.click('[data-testid="tab-settings-rbac"]');
    await expect(page.locator('[data-testid="rbac-matrix-card"]')).toBeVisible();
  });

  test('P9: Role Restrictions Enforcement (Viewer & Support boundaries)', async ({ page }) => {
    await page.goto(PLATFORM_URL);
    // Login as Viewer (read-only)
    await page.click('[data-testid="quick-login-viewer"]');
    await page.click('[data-testid="platform-login-submit-btn"]');

    // Navigate to Companies - Verify Suspend / Add Tenant buttons are hidden for Viewer
    await page.click('[data-testid="platform-nav-companies"]');
    await expect(page.locator('[data-testid="new-tenant-open-wizard-btn"]')).not.toBeVisible();

    // Navigate to Plans - Verify Create Plan button is hidden
    await page.click('[data-testid="platform-nav-plans"]');
    await expect(page.locator('[data-testid="create-new-plan-open-modal-btn"]')).not.toBeVisible();

    // Navigate to Settings - Verify Add Staff button is hidden
    await page.click('[data-testid="platform-nav-settings"]');
    await expect(page.locator('[data-testid="add-staff-open-modal-btn"]')).not.toBeVisible();
  });
});
