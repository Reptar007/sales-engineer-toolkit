/**
 * Project Registry - Central registry for all available projects
 * Add new projects here to make them available in the app
 */

import SalesforceMetrics from './salesforce-metrics';
import RatioEstimator from './ratio-estimator';
import CodeSummaryPDF from './code-summary-pdf';

export const projects = {
  'salesforce-metrics': {
    id: 'salesforce-metrics',
    name: 'Salesforce Metrics',
    description: 'Track and analyze your Salesforce performance',
    icon: '☁️',
    component: SalesforceMetrics,
    path: '/salesforce-metrics',
    category: 'Analytics',
    version: '1.0.0',
    features: ['Data Analysis', 'Reporting', 'Visualization', 'Export Results'],
  },
  'code-summary-pdf': {
    id: 'code-summary-pdf',
    name: 'PDF Generator',
    description: 'Generate summaries of test code and create PDFs',
    icon: '📄',
    component: CodeSummaryPDF,
    path: '/code-summary-pdf',
    category: 'Tools',
    version: '1.0.0',
    features: ['Code Analysis', 'AI Summarization', 'Google Sheets Sync', 'PDF Export'],
  },
  'ratio-estimator': {
    id: 'ratio-estimator',
    name: 'Ratio Estimator',
    description: 'Estimate and review ratios for sales opportunities',
    icon: '📊',
    component: RatioEstimator,
    path: '/ratio-estimator',
    category: 'Tools',
    version: '1.0.0',
    features: ['File Upload', 'AI Estimation', 'Review & Approval', 'Export Results'],
  },
  // Add more projects here as you create them
};

export const getProject = (projectId) => projects[projectId];
export const getAllProjects = () => Object.values(projects);
export const getProjectsByCategory = (category) =>
  Object.values(projects).filter((project) => project.category === category);
