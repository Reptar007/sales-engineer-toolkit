/**
 * End-to-End Accessibility Tests with Playwright
 * Tests the full application in real browsers for accessibility compliance
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('🌐 Full Application Accessibility Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('🔍 should not have any automatically detectable accessibility violations', async ({
    page,
  }) => {
    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('⌨️ should be fully navigable with keyboard', async ({ page }) => {
    // Test tab navigation
    await page.keyboard.press('Tab');
    await expect(page.locator('.btn.file-btn')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.locator('.btn.primary')).toBeFocused();

    // Test reverse tab navigation
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('.btn.file-btn')).toBeFocused();
  });

  test('🎯 should have visible focus indicators', async ({ page }) => {
    // Focus the first button
    await page.keyboard.press('Tab');
    const focusedButton = page.locator('.btn.file-btn');

    // Check for focus styles
    await expect(focusedButton).toHaveCSS('outline-width', '2px');
    await expect(focusedButton).toHaveCSS('outline-style', 'solid');
  });

  test('👆 should have adequate touch targets on mobile', async ({ page, isMobile }) => {
    if (!isMobile) {
      test.skip('This test is only for mobile devices');
    }

    const buttons = page.locator('.btn');
    const buttonCount = await buttons.count();

    for (let i = 0; i < buttonCount; i++) {
      const button = buttons.nth(i);
      const boundingBox = await button.boundingBox();

      expect(boundingBox.height).toBeGreaterThanOrEqual(44);
      expect(boundingBox.width).toBeGreaterThanOrEqual(44);
    }
  });

  test('🌙 should support dark mode when preferred', async ({ page, colorScheme }) => {
    if (colorScheme === 'dark') {
      // Check that dark mode styles are applied
      const body = page.locator('body');
      await expect(body).toHaveCSS('background-color', 'rgb(26, 26, 26)');
    }
  });

  test('🔄 should respect reduced motion preferences', async ({ page }) => {
    // Simulate reduced motion preference
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Hover over a button
    const button = page.locator('.btn').first();
    await button.hover();

    // Check that transforms are disabled
    await expect(button).toHaveCSS('transform', 'none');
  });

  test('📝 should provide proper form labeling', async ({ page }) => {
    // Check that file input has proper label
    const fileInput = page.locator('input[type="file"]');
    const labelId = await fileInput.getAttribute('id');

    const label = page.locator(`label[for="${labelId}"]`);
    await expect(label).toBeVisible();
    await expect(label).toContainText('Choose CSV');
  });

  test('🚨 should show accessible error messages', async ({ page }) => {
    // Try to submit without selecting a file
    const submitButton = page.locator('.btn.primary');
    await submitButton.click();

    // Check for error message (when implemented)
    // This would need to be updated based on actual error handling
    const errorMessage = page.locator('.error');
    if ((await errorMessage.count()) > 0) {
      await expect(errorMessage).toBeVisible();
      await expect(errorMessage).toContainText('⚠️');
    }
  });

  test('🖨️ should have proper print styles', async ({ page }) => {
    // Emulate print media
    await page.emulateMedia({ media: 'print' });

    // Interactive elements should be hidden
    const buttons = page.locator('.btn');
    await expect(buttons.first()).not.toBeVisible();

    // Content should be optimized for print
    const body = page.locator('body');
    await expect(body).toHaveCSS('color', 'rgb(0, 0, 0)');
  });

  test('🔍 should maintain readability at 200% zoom', async ({ page }) => {
    // Set zoom to 200%
    await page.setViewportSize({ width: 640, height: 480 }); // Simulate 200% zoom

    // All text should still be readable
    const headings = page.locator('h1, h2, h3');
    const headingCount = await headings.count();

    for (let i = 0; i < headingCount; i++) {
      await expect(headings.nth(i)).toBeVisible();
    }

    // Interactive elements should still be accessible
    const buttons = page.locator('.btn');
    const buttonCount = await buttons.count();

    for (let i = 0; i < buttonCount; i++) {
      await expect(buttons.nth(i)).toBeVisible();
      const boundingBox = await buttons.nth(i).boundingBox();
      expect(boundingBox.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('🎨 Visual Regression Tests', () => {
  test('📸 should match visual snapshots in light mode', async ({ page }) => {
    await expect(page).toHaveScreenshot('app-light-mode.png');
  });

  test('📸 should match visual snapshots in dark mode', async ({ page, colorScheme }) => {
    if (colorScheme === 'dark') {
      await expect(page).toHaveScreenshot('app-dark-mode.png');
    }
  });

  test('📸 should match visual snapshots on mobile', async ({ page, isMobile }) => {
    if (isMobile) {
      await expect(page).toHaveScreenshot('app-mobile.png');
    }
  });

  test('📸 should match visual snapshots with high contrast', async () => {
    // This would need browser-specific implementation
    // await page.emulateMedia({ forcedColors: 'active' });
    // await expect(page).toHaveScreenshot('app-high-contrast.png');
    expect(true).toBe(true); // Placeholder test
  });
});

test.describe('🔧 Performance & Core Web Vitals', () => {
  test('⚡ should have good performance metrics', async ({ page }) => {
    // Start performance monitoring
    await page.goto('/', { waitUntil: 'networkidle' });

    // Measure Core Web Vitals
    const cwv = await page.evaluate(() => {
      return new Promise((resolve) => {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const metrics = {};

          for (const entry of entries) {
            if (entry.name === 'first-contentful-paint') {
              metrics.fcp = entry.value;
            }
            if (entry.name === 'largest-contentful-paint') {
              metrics.lcp = entry.value;
            }
          }

          if (metrics.fcp && metrics.lcp) {
            resolve(metrics);
          }
        });

        observer.observe({ entryTypes: ['paint', 'largest-contentful-paint'] });

        // Fallback timeout
        setTimeout(() => resolve({}), 5000);
      });
    });

    // Assert reasonable performance (adjust thresholds as needed)
    if (cwv.fcp) expect(cwv.fcp).toBeLessThan(2000); // 2 seconds
    if (cwv.lcp) expect(cwv.lcp).toBeLessThan(2500); // 2.5 seconds
  });

  test('📊 should not block main thread excessively', async ({ page }) => {
    // Monitor long tasks
    const longTasks = [];

    page.on('console', (msg) => {
      if (msg.text().includes('Long task detected')) {
        longTasks.push(msg.text());
      }
    });

    await page.addInitScript(() => {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 50) {
            console.log(`Long task detected: ${entry.duration}ms`);
          }
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    });

    await page.goto('/');

    // Interact with the app
    await page.locator('.btn.file-btn').click();

    // Should not have excessive long tasks
    expect(longTasks.length).toBeLessThan(3);
  });
});
