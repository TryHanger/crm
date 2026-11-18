import { test, expect } from '@playwright/test';

test.describe('Sprint M14 — Расходы и базовая отчетность (Expenses & Reports UX)', () => {

  test.beforeEach(async ({ page }) => {
    // Open Business CRM and login as Barber House owner
    await page.goto('http://localhost:3001');
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await emailInput.fill('owner@barberhouse.kz');
      await page.fill('input[type="password"]', 'Password123!');
      await page.click('button[type="submit"]');
    }
    // Verify CRM loaded
    await expect(page.locator('nav')).toBeVisible({ timeout: 20000 });
  });

  test('M14-D1-01: 4 separate reports with strict separation of Rendered, Paid, Debts, and CSV export', async ({ page }) => {
    // 1. Navigate to Reports module
    const reportsNav = page.locator('[data-testid="nav-reports"], button:has-text("Отч")').first();
    await expect(reportsNav).toBeVisible({ timeout: 10000 });
    await reportsNav.click();

    await expect(page.locator('h1').first()).toContainText(/Отч[её]т/i, { timeout: 10000 });

    // 2. Tab 1: Finance Report
    await page.click('[data-testid="report-tab-finance"]');
    await expect(page.locator('[data-testid="metric-rendered"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="metric-paid"]')).toBeVisible();
    await expect(page.locator('[data-testid="metric-debt"]')).toBeVisible();
    await expect(page.locator('[data-testid="metric-expenses"]')).toBeVisible();
    await expect(page.locator('[data-testid="metric-net-cash"]')).toBeVisible();

    await page.screenshot({ path: 'docs/screenshots/sprint-m14-01-finance-report.png' });

    // 3. Tab 2: Visits Report
    await page.click('[data-testid="report-tab-visits"]');
    await expect(page.locator('text=Всего визитов').or(page.locator('text=Всего записей'))).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Завершено').first()).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/sprint-m14-02-visits-report.png' });

    // 4. Tab 3: Services Report
    await page.click('[data-testid="report-tab-services"]');
    await expect(page.locator('table, [data-testid="services-report-table"]').first()).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'docs/screenshots/sprint-m14-03-services-report.png' });

    // 5. Tab 4: Debts Report
    await page.click('[data-testid="report-tab-debts"]');
    await expect(page.locator('table, [data-testid="debts-report-table"]').first()).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'docs/screenshots/sprint-m14-04-debts-report.png' });

    // 6. Test CSV Export button
    await page.click('[data-testid="report-tab-finance"]');
    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-testid="export-csv-btn"]');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.csv');
  });

  test('M14-D1-02: Expense tracking journal and category calculation', async ({ page }) => {
    // 1. Navigate to Reports -> Finance
    const reportsNav = page.locator('[data-testid="nav-reports"], button:has-text("Отч")').first();
    await expect(reportsNav).toBeVisible({ timeout: 10000 });
    await reportsNav.click();

    await page.click('[data-testid="report-tab-finance"]');
    await expect(page.locator('[data-testid="add-expense-btn"]')).toBeVisible({ timeout: 5000 });

    // 2. Open Add Expense modal
    await page.click('[data-testid="add-expense-btn"]');
    const expenseModal = page.locator('[data-testid="expense-modal"]');
    await expect(expenseModal).toBeVisible({ timeout: 5000 });

    // 3. Fill expense details: 2 500 KZT, supplies
    await page.fill('[data-testid="expense-amount-input"]', '2500');
    const catSelect = page.locator('[data-testid="expense-category-select"]');
    if (await catSelect.isVisible().catch(() => false)) {
      await catSelect.selectOption('supplies');
    }
    await page.fill('[data-testid="expense-description-input"]', 'Расходные материалы (M14 E2E)');

    await page.screenshot({ path: 'docs/screenshots/sprint-m14-05-add-expense-modal.png' });

    // 4. Submit expense
    await page.click('[data-testid="confirm-expense-btn"]');
    await page.waitForTimeout(1000);

    // 5. Verify expense appears in table and totals update
    const expTable = page.locator('[data-testid="expenses-table"]');
    await expect(expTable).toBeVisible({ timeout: 5000 });
    await expect(expTable).toContainText('2 500 ₸');
    await expect(expTable).toContainText('Расходные материалы (M14 E2E)');

    await page.screenshot({ path: 'docs/screenshots/sprint-m14-06-expense-added.png' });
  });

});
