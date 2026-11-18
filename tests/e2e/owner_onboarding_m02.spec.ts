import { test, expect } from '@playwright/test';

test.describe('M02: Owner Onboarding & First Branch Creation (Gate T02)', () => {
  test.describe.configure({ mode: 'serial' });

  const CRM_URL = process.env.CRM_URL || 'http://127.0.0.1:3001';
  const API_URL = process.env.API_URL || 'http://127.0.0.1:8000';

  const runId = Date.now().toString().slice(-5);
  const companySlug = `corp${runId}`;
  const companyName = `Салон Красоты ${runId}`;
  const ownerEmail = `owner_${companySlug}@testcorp.kz`;
  const ownerPassword = `SecurePass_${runId}!`;
  let inviteToken = '';

  test('T02.1: Standalone Onboarding Preview Mode ("Экран готовится отдельно")', async ({ page }) => {
    // 1. Open preview onboarding screen without prior auth
    await page.goto(`${CRM_URL}/?preview=onboarding`);
    await expect(page.locator('[data-testid="onboarding-module"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="onboarding-preview-badge"]')).toBeVisible();

    // 2. Verify all checklist steps are rendered
    await expect(page.locator('[data-testid="onboarding-step-branch"]')).toBeVisible();
    await expect(page.locator('[data-testid="onboarding-step-services"]')).toBeVisible();
    await expect(page.locator('[data-testid="onboarding-step-staff"]')).toBeVisible();
    await expect(page.locator('[data-testid="onboarding-step-booking"]')).toBeVisible();

    // 3. Step 1: Create First Branch in preview
    await page.fill('[data-testid="onboarding-branch-name-input"]', `Флагман ${companyName}`);
    await page.fill('[data-testid="onboarding-branch-city-input"]', 'Астана');
    await page.fill('[data-testid="onboarding-branch-address-input"]', 'пр. Туран, 18');
    await page.fill('[data-testid="onboarding-branch-phone-input"]', '+7 (701) 777-88-99');

    await page.click('[data-testid="onboarding-create-branch-btn"]');

    // 4. Verify branch completion status
    await expect(page.locator('[data-testid="step-branch-completed-badge"]')).toBeVisible();
    await expect(page.locator('[data-testid="onboarding-go-to-calendar-btn"]')).toBeEnabled();
  });

  test('T02.2: Real Onboarding via Invite & First Branch Setup (No dev bypass)', async ({ page, request }) => {
    // 1. Authenticate as Platform Owner via API to issue invite
    const platformLoginRes = await request.post(`${API_URL}/api/v1/auth/login`, {
      data: {
        email: 'admin@platform.kz',
        password: 'Password123!',
      },
    });
    expect(platformLoginRes.ok()).toBeTruthy();
    const platformLoginData = await platformLoginRes.json();
    const platformToken = platformLoginData.access_token;

    // 2. Create Tenant & generate single-use invite token
    const createTenantRes = await request.post(`${API_URL}/api/v1/platform/tenants`, {
      headers: {
        Authorization: `Bearer ${platformToken}`,
      },
      data: {
        slug: companySlug,
        display_name: companyName,
        owner_email: ownerEmail,
        owner_name: 'Бауржан Омаров',
        vertical: 'beauty',
        plan_code: 'start',
      },
    });
    expect(createTenantRes.status()).toBe(201);
    const tenantData = await createTenantRes.json();
    inviteToken = tenantData.invite_token;
    expect(inviteToken).toBeTruthy();

    // 3. Owner opens invite URL
    await page.goto(`${CRM_URL}/accept-invite?token=${inviteToken}`);
    await expect(page.locator('[data-testid="accept-invite-page"]')).toBeVisible({ timeout: 15000 });

    // 4. Verify validation: password mismatch
    await page.fill('[data-testid="invite-name-input"]', 'Бауржан Омаров');
    await page.fill('[data-testid="invite-password-input"]', ownerPassword);
    await page.fill('[data-testid="invite-confirm-password-input"]', 'MismatchPass999!');
    await page.click('[data-testid="invite-submit-btn"]');
    await expect(page.locator('[data-testid="accept-invite-error"]')).toContainText('Пароли не совпадают');

    // 5. Complete activation with matching password
    await page.fill('[data-testid="invite-confirm-password-input"]', ownerPassword);
    await page.click('[data-testid="invite-submit-btn"]');
    await expect(page.locator('[data-testid="accept-invite-success"]')).toBeVisible({ timeout: 10000 });

    // 6. Automatically redirects to Onboarding checklist because tenant has NO branches yet
    await expect(page.locator('[data-testid="onboarding-module"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="onboarding-welcome-title"]')).toContainText(companyName);

    // 7. Fill & create first branch in real database
    const branchName = `Центральный салон ${runId}`;
    await page.fill('[data-testid="onboarding-branch-name-input"]', branchName);
    await page.fill('[data-testid="onboarding-branch-city-input"]', 'Астана');
    await page.fill('[data-testid="onboarding-branch-address-input"]', 'ул. Достык, 42');
    await page.fill('[data-testid="onboarding-branch-phone-input"]', '+7 (701) 123-45-67');

    await page.click('[data-testid="onboarding-create-branch-btn"]');

    // 8. Verify branch creation badge
    await expect(page.locator('[data-testid="step-branch-completed-badge"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=' + branchName)).toBeVisible();

    // 9. Proceed to Calendar
    await page.click('[data-testid="onboarding-go-to-calendar-btn"]');
    await expect(page.locator('h1')).toContainText('Календарь записей', { timeout: 10000 });
    await expect(page.locator('[data-testid="header-onboarding-btn"]')).toBeVisible();
  });

  test('T02.3: Replay Attack Defense (Single-use token invalidation)', async ({ page }) => {
    expect(inviteToken).toBeTruthy();

    // Try reusing the consumed token in a fresh context
    const freshContext = await page.context().browser()!.newContext();
    const freshPage = await freshContext.newPage();

    await freshPage.goto(`${CRM_URL}/accept-invite?token=${inviteToken}`);
    await expect(freshPage.locator('[data-testid="accept-invite-page"]')).toBeVisible();

    await freshPage.fill('[data-testid="invite-name-input"]', 'Второй Вход');
    await freshPage.fill('[data-testid="invite-password-input"]', ownerPassword);
    await freshPage.fill('[data-testid="invite-confirm-password-input"]', ownerPassword);
    await freshPage.click('[data-testid="invite-submit-btn"]');

    // Must show clear error that token is invalid or expired
    await expect(freshPage.locator('[data-testid="accept-invite-error"]')).toBeVisible();
    await expect(freshPage.locator('[data-testid="goto-login-btn"]')).toBeVisible();

    // Owner can log in normally with established password
    await freshPage.click('[data-testid="goto-login-btn"]');
    await freshPage.fill('input[type="email"]', ownerEmail);
    await freshPage.fill('input[type="password"]', ownerPassword);
    await freshPage.click('button[type="submit"]');

    await expect(freshPage.locator('header')).toContainText(companyName, { timeout: 15000 });
    await freshContext.close();
  });
});
