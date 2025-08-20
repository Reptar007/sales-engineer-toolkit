#!/usr/bin/env node

/**
 * Comprehensive Accessibility Test Suite
 * Tests all the accessibility and scalability features we implemented
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const execAsync = promisify(exec);

class AccessibilityTester {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      tests: [],
    };
  }

  async runAllTests() {
    console.log('🧪 Running Accessibility & Scalability Tests...\n');

    // Load CSS for analysis
    const cssPath = join(__dirname, '..', 'src', 'index.css');
    const css = readFileSync(cssPath, 'utf8');

    await this.testFocusManagement(css);
    await this.testTouchTargets(css);
    await this.testMotionPreferences(css);
    await this.testColorSchemes(css);
    await this.testPrintStyles(css);
    await this.testInternationalization(css);
    await this.testResponsiveTypography(css);
    await this.testAccessibilityClasses(css);
    await this.testHighContrastMode(css);

    this.printResults();
  }

  test(name, condition, details = '') {
    const passed = !!condition;
    this.results.tests.push({ name, passed, details });

    if (passed) {
      this.results.passed++;
      console.log(`✅ ${name}`);
    } else {
      this.results.failed++;
      console.log(`❌ ${name}`);
      if (details) console.log(`   ${details}`);
    }
  }

  testFocusManagement(css) {
    console.log('🎯 Testing Focus Management...');

    // Test focus-visible selectors
    this.test(
      'Focus-visible selectors defined',
      css.includes(':focus-visible') && css.includes('outline:'),
      'Should have focus-visible styles with outline',
    );

    // Test focus ring variables
    this.test(
      'Focus ring CSS variables defined',
      css.includes('--focus-ring-width') &&
        css.includes('--focus-ring-offset') &&
        css.includes('--focus-ring-color'),
      'Should define focus ring width, offset, and color variables',
    );

    // Test multiple interactive elements have focus styles
    this.test(
      'Multiple interactive elements have focus styles',
      css.includes('button:focus-visible') &&
        css.includes('input:focus-visible') &&
        css.includes('.btn:focus-visible'),
      'Buttons, inputs, and custom elements should have focus styles',
    );

    console.log('');
  }

  testTouchTargets(css) {
    console.log('👆 Testing Touch Targets...');

    // Test minimum touch target variable
    this.test(
      'Minimum touch target variable defined',
      css.includes('--min-touch-target: 2.75rem'),
      'Should define minimum 44px (2.75rem) touch target',
    );

    // Test buttons use minimum touch target
    this.test(
      'Buttons use minimum touch target',
      css.includes('min-height: var(--min-touch-target)') &&
        css.includes('min-width: var(--min-touch-target)'),
      'Buttons should have minimum height and width for touch',
    );

    console.log('');
  }

  testMotionPreferences(css) {
    console.log('🔄 Testing Motion Preferences...');

    // Test prefers-reduced-motion media query
    this.test(
      'Reduced motion media query exists',
      css.includes('@media (prefers-reduced-motion: reduce)'),
      'Should respect user motion preferences',
    );

    // Test animation duration override
    this.test(
      'Animation duration override for reduced motion',
      css.includes('animation-duration: 0.01ms !important') &&
        css.includes('transition-duration: 0.01ms !important'),
      'Should reduce animation and transition durations',
    );

    // Test transform override
    this.test(
      'Transform override for reduced motion',
      css.includes('transform: none'),
      'Should disable transform animations when motion is reduced',
    );

    console.log('');
  }

  testColorSchemes(css) {
    console.log('🌙 Testing Color Schemes...');

    // Test dark mode media query
    this.test(
      'Dark mode media query exists',
      css.includes('@media (prefers-color-scheme: dark)'),
      'Should support automatic dark mode',
    );

    // Test dark mode color overrides
    this.test(
      'Dark mode color variables overridden',
      css.includes('--canvas: #1a1a1a') && css.includes('--bark-700: #e5e5e5'),
      'Should override key colors for dark mode',
    );

    console.log('');
  }

  testPrintStyles(css) {
    console.log('🖨️ Testing Print Styles...');

    // Test print media query
    this.test(
      'Print media query exists',
      css.includes('@media print'),
      'Should have optimized print styles',
    );

    // Test print optimizations
    this.test(
      'Print optimizations applied',
      css.includes('background: transparent !important') && css.includes('color: black !important'),
      'Should optimize colors and backgrounds for printing',
    );

    // Test interactive elements hidden in print
    this.test(
      'Interactive elements hidden in print',
      css.includes('.btn,') && css.includes('display: none !important'),
      'Should hide interactive elements in print',
    );

    console.log('');
  }

  testInternationalization(css) {
    console.log('🌍 Testing Internationalization...');

    // Test logical properties
    this.test(
      'Logical properties used',
      css.includes('padding-inline') &&
        css.includes('margin-block') &&
        css.includes('inset-inline-start'),
      'Should use logical properties for RTL support',
    );

    console.log('');
  }

  testResponsiveTypography(css) {
    console.log('📱 Testing Responsive Typography...');

    // Test clamp() usage
    this.test(
      'Clamp() used for responsive typography',
      css.includes('clamp(') && css.includes('font-size: clamp('),
      'Should use clamp() for fluid typography',
    );

    // Test viewport units in clamp
    this.test(
      'Viewport units used in clamp',
      css.includes('4vw') || css.includes('3vw'),
      'Should use viewport units for responsive scaling',
    );

    console.log('');
  }

  testAccessibilityClasses(css) {
    console.log('♿ Testing Accessibility Helper Classes...');

    // Test screen reader only class
    this.test(
      'Screen reader only class defined',
      css.includes('.sr-only') &&
        css.includes('position: absolute !important') &&
        css.includes('width: 1px !important'),
      'Should have screen reader only utility class',
    );

    // Test skip link
    this.test(
      'Skip link styles defined',
      css.includes('.skip-link') && css.includes('top: -40px'),
      'Should have skip link for keyboard navigation',
    );

    // Test error state enhancements
    this.test(
      'Enhanced error states',
      css.includes('.error::before') && css.includes("content: '⚠️'"),
      'Should have visual error indicators',
    );

    console.log('');
  }

  testHighContrastMode(css) {
    console.log('🔆 Testing High Contrast Mode...');

    // Test high contrast media query
    this.test(
      'High contrast media query exists',
      css.includes('@media (prefers-contrast: high)'),
      'Should support high contrast mode',
    );

    // Test system color keywords
    this.test(
      'System color keywords used',
      css.includes('ButtonText') && css.includes('Highlight'),
      'Should use system color keywords for high contrast',
    );

    console.log('');
  }

  printResults() {
    console.log('📊 Test Results Summary');
    console.log('='.repeat(50));
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`📝 Total:  ${this.results.tests.length}`);

    const successRate = Math.round((this.results.passed / this.results.tests.length) * 100);
    console.log(`📈 Success Rate: ${successRate}%`);

    if (this.results.failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.tests
        .filter((test) => !test.passed)
        .forEach((test) => {
          console.log(`   • ${test.name}`);
          if (test.details) console.log(`     ${test.details}`);
        });
    }

    console.log('\n🎉 Accessibility test suite completed!');

    if (this.results.failed === 0) {
      console.log('🏆 All accessibility features are properly implemented!');
    } else {
      console.log('⚠️  Some accessibility features need attention.');
      process.exit(1);
    }
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new AccessibilityTester();
  tester.runAllTests().catch(console.error);
}

export default AccessibilityTester;
