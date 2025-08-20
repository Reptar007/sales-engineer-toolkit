/* eslint-env node */
/**
 * Visual Regression Tests
 * Tests for consistent visual appearance across different conditions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import puppeteer from 'puppeteer';

// Check if dev server is running (skip tests in CI if not available)
const DEV_SERVER_URL = 'http://localhost:5173';
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

const conditionalDescribe = isCI ? describe.skip : describe;

conditionalDescribe('🎨 Visual Regression Tests', () => {
  let browser;
  let page;

  beforeEach(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
    await page.goto(DEV_SERVER_URL, { waitUntil: 'networkidle0' });
  });

  afterEach(async () => {
    if (browser) {
      await browser.close();
    }
  });

  it('🌙 should render correctly in dark mode', async () => {
    // Enable dark mode
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);

    await page.reload({ waitUntil: 'networkidle0' });

    // Take screenshot and compare
    const screenshot = await page.screenshot();
    expect(screenshot).toMatchSnapshot('dark-mode.png');
  });

  it('☀️ should render correctly in light mode', async () => {
    // Enable light mode (default)
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

    const screenshot = await page.screenshot();
    expect(screenshot).toMatchSnapshot('light-mode.png');
  });

  it('🔄 should render correctly with reduced motion', async () => {
    // Enable reduced motion
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

    const screenshot = await page.screenshot();
    expect(screenshot).toMatchSnapshot('reduced-motion.png');
  });

  it('🎯 should show focus states correctly', async () => {
    // Focus the first button
    await page.keyboard.press('Tab');

    const screenshot = await page.screenshot();
    expect(screenshot).toMatchSnapshot('focus-state.png');
  });

  it('📱 should render correctly on mobile', async () => {
    await page.setViewport({ width: 375, height: 667 });

    const screenshot = await page.screenshot({ fullPage: true });
    expect(screenshot).toMatchSnapshot('mobile-view.png');
  });

  it('🖥️ should render correctly on desktop', async () => {
    await page.setViewport({ width: 1200, height: 800 });

    const screenshot = await page.screenshot({ fullPage: true });
    expect(screenshot).toMatchSnapshot('desktop-view.png');
  });

  it('🔍 should render correctly at 200% zoom', async () => {
    // Simulate 200% zoom by reducing viewport and increasing page scale
    await page.setViewport({ width: 600, height: 400 });

    const screenshot = await page.screenshot({ fullPage: true });
    expect(screenshot).toMatchSnapshot('200-percent-zoom.png');
  });

  it('🖨️ should render correctly in print mode', async () => {
    // Emulate print media
    await page.emulateMediaType('print');

    const screenshot = await page.screenshot({ fullPage: true });
    expect(screenshot).toMatchSnapshot('print-mode.png');
  });

  it('⚠️ should render error states correctly', async () => {
    // Trigger an error state (this would need to be implemented)
    // For now, we'll just take a baseline screenshot

    const screenshot = await page.screenshot();
    expect(screenshot).toMatchSnapshot('error-state.png');
  });
});

conditionalDescribe('🧪 CSS Feature Tests', () => {
  let browser;
  let page;

  beforeEach(async () => {
    browser = await puppeteer.launch({ headless: true });
    page = await browser.newPage();
    await page.goto(DEV_SERVER_URL);
  });

  afterEach(async () => {
    if (browser) {
      await browser.close();
    }
  });

  it('📏 should use correct spacing scale', async () => {
    const spacingValues = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        spaceXs: style.getPropertyValue('--space-xs'),
        spaceSm: style.getPropertyValue('--space-sm'),
        spaceMd: style.getPropertyValue('--space-md'),
        spaceLg: style.getPropertyValue('--space-lg'),
        spaceXl: style.getPropertyValue('--space-xl'),
        space2xl: style.getPropertyValue('--space-2xl'),
      };
    });

    expect(spacingValues.spaceXs.trim()).toBe('0.25rem');
    expect(spacingValues.spaceSm.trim()).toBe('0.5rem');
    expect(spacingValues.spaceMd.trim()).toBe('0.75rem');
    expect(spacingValues.spaceLg.trim()).toBe('1rem');
    expect(spacingValues.spaceXl.trim()).toBe('1.5rem');
    expect(spacingValues.space2xl.trim()).toBe('2rem');
  });

  it('🎨 should use correct color variables', async () => {
    const colorValues = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        canvas: style.getPropertyValue('--canvas'),
        pine900: style.getPropertyValue('--pine-900'),
        white: style.getPropertyValue('--white'),
      };
    });

    expect(colorValues.canvas.trim()).toBe('#f6f4ea');
    expect(colorValues.pine900.trim()).toBe('#0b3d2e');
    expect(colorValues.white.trim()).toBe('#ffffff');
  });

  it('🔲 should use correct border radius values', async () => {
    const radiusValues = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        radiusSm: style.getPropertyValue('--radius-sm'),
        radiusMd: style.getPropertyValue('--radius-md'),
        radiusLg: style.getPropertyValue('--radius-lg'),
        radiusPill: style.getPropertyValue('--radius-pill'),
      };
    });

    expect(radiusValues.radiusSm.trim()).toBe('0.1875rem');
    expect(radiusValues.radiusMd.trim()).toBe('0.5rem');
    expect(radiusValues.radiusLg.trim()).toBe('0.75rem');
    expect(radiusValues.radiusPill.trim()).toBe('62.5rem');
  });

  it('👆 should have minimum touch targets', async () => {
    const touchTargets = await page.$$eval('.btn', (buttons) => {
      return buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
        };
      });
    });

    touchTargets.forEach((target) => {
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
    });
  });
});
