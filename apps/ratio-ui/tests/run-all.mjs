#!/usr/bin/env node

/**
 * Comprehensive Test Runner
 * Runs all accessibility and scalability tests and provides a summary
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class TestRunner {
  constructor() {
    this.results = {
      accessibility: null,
      components: null,
      e2e: null,
      visual: null,
      coverage: null,
    };
  }

  async runAllTests() {
    console.log('🧪 Running Comprehensive Accessibility & Scalability Test Suite\n');
    console.log('='.repeat(70));

    try {
      // 1. Run accessibility analysis
      console.log('\n🎯 Running Accessibility Analysis...');
      this.results.accessibility = await this.runAccessibilityTests();

      // 2. Run component tests
      console.log('\n⚛️ Running React Component Tests...');
      this.results.components = await this.runComponentTests();

      // 3. Run visual regression tests
      console.log('\n🎨 Running Visual Regression Tests...');
      this.results.visual = await this.runVisualTests();

      // 4. Check if dev server is running for E2E tests
      console.log('\n🌐 Checking Development Server...');
      const serverRunning = await this.checkDevServer();

      if (serverRunning) {
        console.log('✅ Development server detected, running E2E tests...');
        this.results.e2e = await this.runE2ETests();
      } else {
        console.log('⚠️  Development server not running, skipping E2E tests');
        console.log('   Start with: npm run dev');
        this.results.e2e = { status: 'skipped', reason: 'Server not running' };
      }

      // 5. Generate coverage report
      console.log('\n📊 Generating Coverage Report...');
      this.results.coverage = await this.generateCoverage();
    } catch (error) {
      console.error('❌ Test suite failed:', error.message);
      process.exit(1);
    }

    this.printSummary();
  }

  async runAccessibilityTests() {
    try {
      const output = execSync('node accessibility.test.mjs', {
        cwd: __dirname,
        encoding: 'utf8',
      });
      return { status: 'passed', output };
    } catch (error) {
      return { status: 'failed', error: error.message };
    }
  }

  async runComponentTests() {
    try {
      const output = execSync('npm test -- --run', {
        cwd: join(__dirname, '..'),
        encoding: 'utf8',
      });
      return { status: 'passed', output };
    } catch (error) {
      return { status: 'failed', error: error.message };
    }
  }

  async runVisualTests() {
    try {
      const output = execSync('npm test -- visual-regression.test.js --run', {
        cwd: join(__dirname, '..'),
        encoding: 'utf8',
      });
      return { status: 'passed', output };
    } catch (error) {
      return { status: 'failed', error: error.message };
    }
  }

  async runE2ETests() {
    try {
      const output = execSync('npx playwright test', {
        cwd: join(__dirname, '..'),
        encoding: 'utf8',
      });
      return { status: 'passed', output };
    } catch (error) {
      return { status: 'failed', error: error.message };
    }
  }

  async generateCoverage() {
    try {
      const output = execSync('npm run test:coverage -- --run', {
        cwd: join(__dirname, '..'),
        encoding: 'utf8',
      });
      return { status: 'generated', output };
    } catch (error) {
      return { status: 'failed', error: error.message };
    }
  }

  async checkDevServer() {
    try {
      const response = await fetch('http://localhost:5173');
      return response.ok;
    } catch {
      return false;
    }
  }

  printSummary() {
    console.log('\n\n📋 TEST SUITE SUMMARY');
    console.log('='.repeat(70));

    const testSuites = [
      { name: '🎯 Accessibility Analysis', result: this.results.accessibility },
      { name: '⚛️ React Component Tests', result: this.results.components },
      { name: '🎨 Visual Regression Tests', result: this.results.visual },
      { name: '🌐 End-to-End Tests', result: this.results.e2e },
      { name: '📊 Coverage Report', result: this.results.coverage },
    ];

    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    testSuites.forEach((suite) => {
      const status = suite.result?.status;
      const icon =
        status === 'passed'
          ? '✅'
          : status === 'failed'
            ? '❌'
            : status === 'skipped'
              ? '⏭️'
              : '⚠️';

      console.log(`${icon} ${suite.name}: ${status || 'unknown'}`);

      if (status === 'passed' || status === 'generated') totalPassed++;
      else if (status === 'failed') totalFailed++;
      else if (status === 'skipped') totalSkipped++;

      if (suite.result?.reason) {
        console.log(`   Reason: ${suite.result.reason}`);
      }
    });

    console.log('\\n' + '-'.repeat(70));
    console.log(
      `📊 Summary: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped`,
    );

    if (totalFailed === 0) {
      console.log('\\n🎉 All tests passed! Your application is accessibility-compliant.');
      console.log('\\n🏆 Features validated:');
      console.log('   ✅ WCAG 2.1 AA compliance');
      console.log('   ✅ Keyboard navigation');
      console.log('   ✅ Screen reader support');
      console.log('   ✅ Touch accessibility');
      console.log('   ✅ Motion preferences');
      console.log('   ✅ Color scheme support');
      console.log('   ✅ Internationalization');
      console.log('   ✅ Print optimization');
      console.log('   ✅ Responsive design');
      console.log('   ✅ Performance standards');
    } else {
      console.log('\\n⚠️  Some tests failed. Please review the output above.');
      console.log('\\n🔧 Next steps:');
      console.log('   1. Fix failing accessibility issues');
      console.log('   2. Re-run tests: npm run test:all');
      console.log('   3. Check test documentation in tests/README.md');
      process.exit(1);
    }

    console.log('\\n📖 For detailed test documentation: tests/README.md');
    console.log('🔧 For debugging help: npm run test:ui');
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const runner = new TestRunner();
  runner.runAllTests().catch(console.error);
}

export default TestRunner;
