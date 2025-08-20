# 🧪 Accessibility & Scalability Test Suite

This comprehensive test suite validates all the accessibility and scalability features implemented in the Ratio UI application.

## 📋 Test Categories

### 1. 🎯 Accessibility Tests (`accessibility.test.mjs`)

**Static CSS analysis** that checks for proper implementation of accessibility features:

- ✅ Focus management and keyboard navigation
- ✅ Touch target minimum sizes (44px)
- ✅ Motion preference support (`prefers-reduced-motion`)
- ✅ Color scheme support (dark/light mode)
- ✅ Print optimizations
- ✅ Internationalization (RTL support)
- ✅ Screen reader support
- ✅ High contrast mode
- ✅ Responsive typography

### 2. ⚛️ React Component Tests (`components.test.jsx`)

**Unit tests** for React components using Testing Library:

- ✅ Focus management in real DOM
- ✅ Keyboard navigation functionality
- ✅ Touch target validation
- ✅ Semantic HTML structure
- ✅ ARIA labels and descriptions
- ✅ Form accessibility
- ✅ Responsive behavior

### 3. 🌐 End-to-End Tests (`e2e/accessibility.spec.js`)

**Full browser tests** using Playwright with axe-core:

- ✅ Automated accessibility scanning
- ✅ Keyboard navigation in real browsers
- ✅ Visual focus indicators
- ✅ Mobile touch targets
- ✅ Dark mode functionality
- ✅ Reduced motion preferences
- ✅ Print mode testing
- ✅ Zoom level testing (200%)
- ✅ Performance monitoring
- ✅ Core Web Vitals

### 4. 🎨 Visual Regression Tests (`visual-regression.test.js`)

**Screenshot testing** using Puppeteer:

- ✅ Dark/light mode visual consistency
- ✅ Focus state appearance
- ✅ Mobile vs desktop layouts
- ✅ Zoom level appearance
- ✅ Print mode styles
- ✅ Error state visuals

## 🚀 Running Tests

### Run All Tests

\`\`\`bash
npm run test:all
\`\`\`

### Run Individual Test Suites

#### CSS/Accessibility Analysis

\`\`\`bash
npm run test:a11y
\`\`\`

#### React Component Tests

\`\`\`bash
npm test
\`\`\`

#### End-to-End Tests

\`\`\`bash
npm run test:visual
\`\`\`

#### Visual Regression Tests

\`\`\`bash
npm run test -- visual-regression.test.js
\`\`\`

### Test with Coverage

\`\`\`bash
npm run test:coverage
\`\`\`

### Interactive Test UI

\`\`\`bash
npm run test:ui
\`\`\`

## 📊 What Each Test Validates

### 🎯 Focus Management

- Visible focus indicators with proper contrast
- Keyboard navigation through all interactive elements
- Focus trap in modals (when applicable)
- Skip links for screen readers

### 👆 Touch Accessibility

- Minimum 44px touch targets on all interactive elements
- Adequate spacing between touch targets
- Mobile-friendly interaction areas

### 🔄 Motion & Animation

- Respects `prefers-reduced-motion` setting
- Disables animations for users with vestibular disorders
- Maintains functionality without motion

### 🌙 Theme Support

- Automatic dark/light mode detection
- Proper color contrast in all modes
- High contrast mode compatibility

### 🌍 Internationalization

- RTL (right-to-left) language support
- Logical CSS properties usage
- Text direction compatibility

### 📱 Responsive Design

- Fluid typography scaling
- Touch-friendly mobile interface
- Zoom support up to 200%
- Container query readiness

### 🖨️ Print Optimization

- Clean print styles
- Hidden interactive elements
- High contrast for printing
- Proper page breaks

### ⚡ Performance

- Core Web Vitals monitoring
- Long task detection
- Efficient CSS loading
- Accessibility tree optimization

## 🛠️ Test Configuration

### Playwright Configuration (`playwright.config.js`)

- Multiple browser testing (Chrome, Firefox, Safari)
- Mobile device simulation
- Accessibility-focused test projects
- Visual regression capabilities

### Vitest Configuration (`vite.config.js`)

- React Testing Library integration
- JSDOM environment
- Coverage reporting
- CSS testing support

## 📈 Interpreting Results

### ✅ Success Criteria

- **100% accessibility test pass rate**
- **Zero axe-core violations**
- **All touch targets ≥ 44px**
- **Focus visible on all interactive elements**
- **Proper ARIA labeling**
- **Responsive at all viewport sizes**

### ⚠️ Warning Signs

- Failed keyboard navigation
- Missing focus indicators
- Insufficient color contrast
- Touch targets too small
- Missing semantic markup
- Poor performance metrics

## 🔧 Debugging Failed Tests

### 1. Accessibility Violations

\`\`\`bash

# Run with detailed output

npm run test:a11y -- --verbose
\`\`\`

### 2. Visual Differences

\`\`\`bash

# Generate updated screenshots

npm run test:visual -- --update-snapshots
\`\`\`

### 3. Component Issues

\`\`\`bash

# Run specific test file

npm test -- components.test.jsx
\`\`\`

### 4. Browser-Specific Issues

\`\`\`bash

# Run specific browser

npx playwright test --project=firefox
\`\`\`

## 📝 Test Maintenance

### Adding New Tests

1. **Accessibility**: Add checks to `accessibility.test.mjs`
2. **Components**: Add to `components.test.jsx`
3. **E2E**: Add to `e2e/accessibility.spec.js`
4. **Visual**: Add to `visual-regression.test.js`

### Updating Snapshots

\`\`\`bash
npm run test:visual -- --update-snapshots
\`\`\`

### Performance Benchmarks

- **First Contentful Paint**: < 2 seconds
- **Largest Contentful Paint**: < 2.5 seconds
- **Long Tasks**: < 3 per session
- **Touch Targets**: ≥ 44px

## 🎯 Compliance Standards

This test suite ensures compliance with:

- **WCAG 2.1 AA** guidelines
- **Section 508** requirements
- **Web Accessibility Initiative** best practices
- **Apple HIG** and **Material Design** accessibility standards
- **Core Web Vitals** performance metrics

## 🚨 CI/CD Integration

For continuous integration, run:
\`\`\`bash

# In CI environment

npm run test:all
\`\`\`

The test suite will exit with code 1 if any accessibility violations are found, failing the build and ensuring accessibility is maintained.
