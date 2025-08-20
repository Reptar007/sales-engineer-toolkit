import '@testing-library/jest-dom';
import { beforeAll, afterEach, vi } from 'vitest';

// Global declarations for ESLint
/* eslint-env node, jsdom */
import { cleanup } from '@testing-library/react';

// Cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup();
});

// Mock browser APIs for tests
beforeAll(() => {
  // Mock IntersectionObserver
  globalThis.IntersectionObserver = vi.fn().mockImplementation(() => ({
    disconnect: vi.fn(),
    observe: vi.fn(),
    unobserve: vi.fn(),
  }));

  // Mock ResizeObserver
  globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
    disconnect: vi.fn(),
    observe: vi.fn(),
    unobserve: vi.fn(),
  }));

  // Mock matchMedia for media query tests
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock getBoundingClientRect for layout tests
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    bottom: 44,
    height: 44, // Default to minimum touch target
    left: 0,
    right: 44,
    top: 0,
    width: 44,
    x: 0,
    y: 0,
    toJSON: vi.fn(),
  }));

  // Mock scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();

  // Mock focus method
  HTMLElement.prototype.focus = vi.fn();

  // Mock CSS getComputedStyle for CSS variable tests
  Object.defineProperty(window, 'getComputedStyle', {
    value: vi.fn(() => ({
      getPropertyValue: vi.fn((prop) => {
        // Mock CSS custom properties for testing
        const cssVars = {
          '--space-xs': '0.25rem',
          '--space-sm': '0.5rem',
          '--space-md': '0.75rem',
          '--space-lg': '1rem',
          '--space-xl': '1.5rem',
          '--space-2xl': '2rem',
          '--canvas': '#f6f4ea',
          '--pine-900': '#0b3d2e',
          '--white': '#ffffff',
          '--radius-sm': '0.1875rem',
          '--radius-md': '0.5rem',
          '--radius-lg': '0.75rem',
          '--radius-pill': '62.5rem',
        };
        return cssVars[prop] || '';
      }),
    })),
  });

  // Mock window.location
  delete window.location;
  window.location = {
    href: 'http://localhost:5173',
    origin: 'http://localhost:5173',
    pathname: '/',
    search: '',
    hash: '',
    assign: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
  };
});
