import { test, expect } from '@playwright/test';

test.describe('Sprint M04: Branch, Services, and Dynamic 8000 KZT Public Price Verification', () => {

  test('M04-D1 End-to-End: Update Branch Details, Create Category & 8000 KZT Service, Verify on Public Booking Site', async ({ page, context }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1280, height: 800 });

    // 1. Log in to CRM as Barber House Owner
    await page.goto('http://localhost:3001');
    await page.fill('input[type="email"]', 'owner@barberhouse.kz');
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button[type="submit"]');

    // Wait for CRM dashboard / navigation
    await expect(page.locator('nav')).toBeVisible({ timeout: 15000 });

    // 2. Navigate to Settings -> Branch Management
    await page.click('nav a:has-text("Настройки"), aside button:has-text("Настройки")');
    await expect(page.locator('h1')).toContainText('Настройки');

    // Verify branch section exists and has the branch card
    await expect(page.locator('[data-testid^="branch-card-"]').first()).toBeVisible({ timeout: 15000 });
    const editBranchBtn = page.locator('[data-testid^="edit-branch-btn-"]').first();
    await expect(editBranchBtn).toBeVisible();
    await editBranchBtn.click();

    // Verify Branch Form fields (City, Working Hours, Address, Timezone)
    const cityInput = page.locator('[data-testid="branch-city-input"]');
    await expect(cityInput).toBeVisible();
    await cityInput.fill('Алматы');

    const hoursInput = page.locator('[data-testid="branch-hours-input"]');
    await expect(hoursInput).toBeVisible();
    await hoursInput.fill('10:00 - 21:00');

    // Save branch changes
    const saveBranchBtn = page.locator('[data-testid="save-branch-submit-btn"]');
    await saveBranchBtn.click();

    // Verify updated details in branch card
    await expect(page.locator('text=Алматы').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=10:00 - 21:00').first()).toBeVisible();

    await page.screenshot({ path: 'docs/screenshots/sprint-m04-01-branch-updated.png', fullPage: true });

    // 3. Navigate to Services Module
    await page.click('nav a:has-text("Услуги"), aside button:has-text("Услуги")');
    await expect(page.locator('h1')).toContainText('Услуги');

    // Verify search and categories are present
    await expect(page.locator('[data-testid="services-search-input"]')).toBeVisible();

    // 4. Create a new Service Category
    const addCatBtn = page.locator('[data-testid="add-category-btn"]');
    await expect(addCatBtn).toBeVisible();
    await addCatBtn.click();

    const catNameInput = page.locator('[data-testid="new-category-name-input"]');
    await expect(catNameInput).toBeVisible();
    const uniqueCatName = `Премиум Уход ${Date.now() % 10000}`;
    await catNameInput.fill(uniqueCatName);

    await page.locator('[data-testid="submit-create-category-btn"]').click();
    await expect(page.locator(`text=${uniqueCatName}`).first()).toBeVisible({ timeout: 10000 });

    // 5. Create a Service with 8 000 KZT price and 45 min duration
    const addServiceBtn = page.locator('[data-testid="add-service-btn"]');
    await expect(addServiceBtn).toBeVisible();
    await addServiceBtn.click();

    // Fill Service details
    const serviceName = `Королевский груминг ${Date.now() % 10000}`;
    await page.fill('[data-testid="new-service-name-input"]', serviceName);

    // Set duration to 45 min using modal quick preset
    const dur45Chip = page.locator('[data-testid="modal-quick-dur-45"]');
    if (await dur45Chip.isVisible()) {
      await dur45Chip.click();
    } else {
      await page.fill('[data-testid="new-service-duration-input"]', '45');
    }

    // Set price to 8000 KZT using preset chip
    const price8000Preset = page.locator('[data-testid="modal-quick-price-8000"]');
    if (await price8000Preset.isVisible()) {
      await price8000Preset.click();
    } else {
      await page.fill('[data-testid="new-service-price-input"]', '8000');
    }

    // Verify live formatted preview shows 8 000 ₸
    await expect(page.locator('text=8 000 ₸').first()).toBeVisible();

    // Submit service
    await page.click('[data-testid="submit-create-service-btn"]');

    // 6. Verify Service appears in the list
    await expect(page.locator(`text=${serviceName}`)).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`:is(tr, div):has-text("${serviceName}") :text("8 000 ₸")`).first()).toBeVisible();

    await page.screenshot({ path: 'docs/screenshots/sprint-m04-02-service-created-8000.png', fullPage: true });

    // 7. Test Search Filter
    await page.fill('[data-testid="services-search-input"]', serviceName);
    await expect(page.locator(`text=${serviceName}`)).toBeVisible();

    // 8. Open Public Booking Web and verify 8 000 KZT service appears dynamically
    const bookingPage = await context.newPage();
    await bookingPage.goto('http://barberhouse.localhost:3000');

    // Wait for services step or branch selection
    await expect(bookingPage.locator('body')).toBeVisible({ timeout: 10000 });

    // If branch selection step is shown, select first branch
    const branchChoice = bookingPage.locator('[data-testid="branch-card"], button:has-text("Филиал"), button:has-text("Выбрать филиал")').first();
    if (await branchChoice.isVisible()) {
      await branchChoice.click();
    }

    // Check if category tab for our new category is present or switch to "Все"
    const allTab = bookingPage.locator('button:has-text("Все")');
    if (await allTab.isVisible()) {
      await allTab.click();
    }

    // Verify the newly created service appears dynamically in public booking catalog with 8 000 ₸!
    const publicServiceItem = bookingPage.locator(`text=${serviceName}`);
    await expect(publicServiceItem).toBeVisible({ timeout: 15000 });

    // Verify 8 000 ₸ is displayed right by the service
    const priceText = bookingPage.locator(`:is(div, button, li):has-text("${serviceName}") :text("8 000 ₸")`);
    await expect(priceText.first()).toBeVisible();

    await bookingPage.screenshot({ path: 'docs/screenshots/sprint-m04-03-booking-public-8000-dynamic.png', fullPage: true });

    await bookingPage.close();
  });
});
