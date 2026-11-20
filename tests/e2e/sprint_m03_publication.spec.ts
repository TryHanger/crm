import { test, expect } from '@playwright/test';

test.describe('Sprint M03: Salon Publication, Personal Link & Scannable QR Code', () => {

  test('M03-D1 Full Lifecycle: CRM Personal Link, Copy, QR Code, Toggle Pause/Resume & Booking Web Verification', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    // Set desktop viewport
    await page.setViewportSize({ width: 1280, height: 800 });

    // 1. Log in to CRM as Barber House Owner
    await page.goto('http://localhost:3001');
    await page.fill('input[type="email"]', 'owner@barberhouse.kz');
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button[type="submit"]');

    // Wait for CRM Dashboard/Calendar to load
    await expect(page.locator('nav')).toBeVisible({ timeout: 10000 });

    // 2. Navigate to Online Booking module
    await page.click('nav a:has-text("Онлайн-запись"), aside button:has-text("Онлайн-запись")');
    await expect(page.locator('h1')).toContainText('Настройки онлайн-записи');

    // 3. Switch to "Публикация и QR-код" tab
    await page.click('button:has-text("Публикация и QR-код")');

    // 4. Verify Personal Link input and controls
    const linkInput = page.locator('[data-testid="booking-public-url-input"]');
    await expect(linkInput).toBeVisible();
    const publicUrl = await linkInput.inputValue();
    expect(publicUrl).toContain('barberhouse');

    // Verify Copy button functionality
    const copyBtn = page.locator('[data-testid="booking-copy-url-btn"]');
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();
    await expect(copyBtn).toContainText('Скопировано');

    // Verify Open link exists
    const openLink = page.locator('[data-testid="booking-public-url-link"]');
    await expect(openLink).toBeVisible();
    const href = await openLink.getAttribute('href');
    expect(href).toBe(publicUrl);

    // 5. Verify Scannable QR Code
    const qrImage = page.locator('[data-testid="booking-qr-code"]');
    await expect(qrImage).toBeVisible({ timeout: 10000 });
    const qrSrc = await qrImage.getAttribute('src');
    expect(qrSrc).toBeTruthy();
    expect(qrSrc?.startsWith('data:image/png;base64,')).toBe(true);

    // Verify Download & Print buttons
    await expect(page.locator('[data-testid="booking-qr-download-link"]')).toBeVisible();
    await expect(page.locator('[data-testid="booking-qr-print-btn"]')).toBeVisible();

    // Screenshot of active publication tab
    await page.screenshot({ path: 'docs/screenshots/sprint-m03-01-crm-publication-active.png', fullPage: true });

    // 6. Test Pause Publication
    const toggleBtn = page.locator('button:has-text("Приостановить"), button:has-text("Опубликовать")');
    await expect(toggleBtn).toBeVisible();

    // Ensure it is published first
    let btnText = await toggleBtn.innerText();
    if (btnText.includes('Опубликовать')) {
      await toggleBtn.click();
      await expect(page.locator('text=Онлайн-запись активна').first()).toBeVisible({ timeout: 5000 });
    }

    // Now click "Приостановить"
    await page.click('button:has-text("Приостановить")');
    await expect(page.locator('text=Онлайн-запись приостановлена').first()).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'docs/screenshots/sprint-m03-02-crm-publication-paused.png', fullPage: true });

    // 7. Verify on Booking Web that paused publication blocks booking
    const bookingPage = await context.newPage();
    await bookingPage.goto('http://barberhouse.localhost:3000');

    // Client must see "Онлайн-запись временно недоступна"
    await expect(bookingPage.locator(':is([data-testid="booking-unpublished-view"], :text("Онлайн-запись временно недоступна"))').first()).toBeVisible({ timeout: 10000 });
    await bookingPage.screenshot({ path: 'docs/screenshots/sprint-m03-03-booking-web-paused.png', fullPage: true });

    // 8. Return to CRM and Resume Publication
    await page.bringToFront();
    await page.click('button:has-text("Опубликовать")');
    await expect(page.locator('text=Онлайн-запись активна').first()).toBeVisible({ timeout: 5000 });

    // 9. Verify on Booking Web that resumed publication restores booking
    await bookingPage.bringToFront();
    await bookingPage.reload();
    await expect(bookingPage.locator('h1:has-text("Выберите услуги"), header:has-text("Barber House")').first()).toBeVisible({ timeout: 10000 });
    await bookingPage.screenshot({ path: 'docs/screenshots/sprint-m03-04-booking-web-resumed.png', fullPage: true });

    // 10. Verify Unknown Host produces Company Not Found (404)
    await bookingPage.goto('http://unknown-company.localhost:3000');
    await expect(bookingPage.locator(':is([data-testid="booking-domain-not-found"], :text("Компания не найдена"))').first()).toBeVisible({ timeout: 10000 });
    await bookingPage.screenshot({ path: 'docs/screenshots/sprint-m03-05-unknown-host-404.png', fullPage: true });

    await bookingPage.close();
  });
});
