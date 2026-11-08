import { test, expect } from '@playwright/test';

test.describe('CRM Full Business Modules & Workflows', () => {

  test.beforeEach(async ({ page }) => {
    // Open CRM and authenticate as Barber House owner
    await page.goto('http://localhost:3001');
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailInput.fill('owner@barberhouse.kz');
      await page.fill('input[type="password"]', 'Password123!');
      await page.click('button[type="submit"]');
      await expect(page.locator('h1')).toContainText('Календарь записей', { timeout: 15000 });
    }
  });

  test('CRM Customers: List, Create Customer, View Profile & Add Note', async ({ page }) => {
    // Navigate to customers
    await page.click('nav a:has-text("Клиенты"), aside button:has-text("Клиенты")');
    await expect(page.locator('h1')).toContainText('Клиентская база');

    // Screenshot initial customers page
    await page.screenshot({ path: 'docs/screenshots/crm-01-customers-list.png', fullPage: true });

    // Open Add Customer Modal
    await page.click('button:has-text("Новый клиент"), button:has-text("+ Новый клиент"), button:has-text("+ Клиент"), button:has-text("Добавить")');
    await expect(page.locator('h3:has-text("Новый клиент")')).toBeVisible();

    // Fill form
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const testPhone = `+7701999${randomSuffix}`;
    const testName = `Тест Клиент ${randomSuffix}`;

    await page.fill('input[placeholder="Иван Петров"]', testName);
    await page.fill('input[placeholder="+7 (701) 000-00-00"]', testPhone);
    await page.click('button:has-text("Создать клиента"), button:has-text("Сохранить")');

    // Confirm customer is visible in table
    await expect(page.locator(`text=${testName}`)).toBeVisible({ timeout: 10000 });

    // Open customer card modal
    await page.click(`text=${testName}`);
    await expect(page.locator('text=Карточка клиента')).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/crm-02-customer-card.png' });

    // Add private note
    const noteInput = page.locator('input[placeholder*="заметк"], textarea[placeholder*="заметк"]').first();
    await expect(noteInput).toBeVisible({ timeout: 5000 });
    await noteInput.fill('Предпочитает чай с бергамотом');
    await page.click('button:has-text("Добавить"), button:has-text("Сохранить")');
    await expect(page.locator('text=Предпочитает чай с бергамотом')).toBeVisible({ timeout: 5000 });

    // Close modal
    await page.click('button:has-text("✕"), button:has-text("Закрыть")');
  });

  test('CRM Staff: Team Roster, Service Overrides & Weekly Schedule', async ({ page }) => {
    // Navigate to staff
    await page.click('nav a:has-text("Сотрудники"), aside button:has-text("Сотрудники")');
    await expect(page.locator('h1')).toContainText('Сотрудники и график');

    // Verify staff members present
    await expect(page.locator('text=Дамир')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'docs/screenshots/crm-03-staff-list.png', fullPage: true });

    // Click on Damir to view staff detail modal
    await page.locator('text=Дамир').first().click();
    await expect(page.locator('text=Сотрудник:').first()).toBeVisible();

    // Switch to Services tab in staff profile
    await page.locator('button:has-text("Услуги и цены"), button:has-text("Прайс-лист")').first().click();
    await page.screenshot({ path: 'docs/screenshots/crm-04-staff-services.png' });

    // Switch to Schedule tab
    await page.click('button:has-text("График работы")');
    await expect(page.locator('text=Понедельник')).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/crm-05-staff-schedule.png' });

    // Close modal
    await page.click('button:has-text("✕")');
  });

  test('CRM Services: Categories, Pricing & Online Availability Editor', async ({ page }) => {
    // Navigate to services
    await page.click('nav a:has-text("Услуги"), aside button:has-text("Услуги")');
    await expect(page.locator('h1')).toContainText('Услуги и цены');

    await page.screenshot({ path: 'docs/screenshots/crm-06-services-3col.png', fullPage: true });

    // Click on a service in the second column
    const serviceItem = page.locator('button:has-text("Мужская стрижка"), div:has-text("Мужская стрижка")').first();
    await serviceItem.click();

    // Editor should display service details on the right
    await expect(page.locator('input[placeholder*="Мужская стрижка"], input[value*="Мужская стрижка"]')).toBeVisible({ timeout: 5000 });

    // Save changes
    await page.click('button:has-text("Сохранить изменения")');
    await expect(page.locator(':is(:text("Услуга успешно обновлена"), :text("Услуга сохранена"))').first()).toBeVisible({ timeout: 5000 });
  });

  test('CRM Online Booking: Rules, Appearance Mockup & Public URL', async ({ page }) => {
    // Navigate to online booking
    await page.click('nav a:has-text("Онлайн-запись"), aside button:has-text("Онлайн-запись")');
    await expect(page.locator('h1')).toContainText('Настройки онлайн-записи');

    // Check Rules tab
    await expect(page.locator(':is(:text("Глубина бронирования"), :text("Глубина записи"))').first()).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/crm-07-booking-rules.png', fullPage: true });

    // Switch to Appearance tab
    await page.click('button:has-text("Внешний вид и предпросмотр")');
    await expect(page.locator('text=Живой предпросмотр')).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/crm-08-booking-appearance.png', fullPage: true });

    // Switch to Publication tab
    await page.click('button:has-text("Публикация и QR-код")');
    await expect(page.locator('text=QR-код').first()).toBeVisible();
    await expect(page.locator('input[value*="barberhouse"], a[href*="barberhouse"]').first()).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/crm-09-booking-publication.png', fullPage: true });
  });

  test('CRM Reports: Fact vs Planned Revenue & Master Utilization', async ({ page }) => {
    // Navigate to reports
    await page.click('nav a:has-text("Отчёты"), aside button:has-text("Отчёты")');
    await expect(page.locator('h1').first()).toContainText('Отчёты и аналитика');

    // Verify key metrics
    await expect(page.locator('text=Всего записей').first()).toBeVisible();
    await expect(page.locator('text=Факт-выручка').first()).toBeVisible();
    await expect(page.locator('text=Плановая стоимость').first()).toBeVisible();
    await expect(page.locator('text=Выработка мастеров').first()).toBeVisible();

    await page.screenshot({ path: 'docs/screenshots/crm-10-reports-overview.png', fullPage: true });
  });

  test('CRM Settings: Branches, Team Access & Invite Generation', async ({ page }) => {
    // Navigate to settings
    await page.click('nav a:has-text("Настройки"), aside button:has-text("Настройки")');
    await expect(page.locator('h1').first()).toContainText('Настройки бизнеса');

    // Check branches tab
    await expect(page.locator('text=Филиалы сети')).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/crm-11-settings-branches.png', fullPage: true });

    // Switch to Users & Roles tab
    await page.click('button:has-text("Пользователи и роли")');
    await expect(page.locator('text=Пользователи и права доступа')).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/crm-12-settings-users.png', fullPage: true });

    // Create staff invite
    await page.click('button:has-text("Пригласить сотрудника")');
    await expect(page.locator('text=Email сотрудника')).toBeVisible();

    const inviteEmail = `newbie_${Date.now()}@barberhouse.kz`;
    await page.fill('input[type="email"]', inviteEmail);
    await page.click('button:has-text("Отправить приглашение")');

    // Verify invite link was generated
    await expect(page.locator('text=Ссылка для активации')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'docs/screenshots/crm-13-settings-invite-generated.png' });
    await page.click('button:has-text("Готово")');

    // Switch to Company & Tariff tab
    await page.click('button:has-text("Компания и тариф")');
    await expect(page.locator('text=Профиль компании')).toBeVisible();
    await expect(page.locator('text=Тариф Pro')).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/crm-14-settings-company.png', fullPage: true });
  });

});
