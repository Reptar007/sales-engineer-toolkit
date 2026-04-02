/**
 * Project Registry - Central registry for all available projects
 * Add new projects here to make them available in the app
 */

import SalesforceMetrics from './salesforce-metrics';
import RatioEstimator from './ratio-estimator';
import FlowDocGenerator from './flow-doc-generator';

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
  'flow-doc-generator': {
    id: 'flow-doc-generator',
    name: 'Flow Doc Generator',
    description: 'Generate a technical leave-behind doc from a QA Wolf flow URL',
    icon: '📄',
    component: FlowDocGenerator,
    path: '/flow-doc-generator',
    category: 'Tools',
    version: '1.0.0',
    features: ['QAW Integration', 'AI Summary', 'Test Step Extraction', 'Leave-Behind Doc'],
  },
  // Add more projects here as you create them
};

export const getProject = (projectId) => projects[projectId];
export const getAllProjects = () => Object.values(projects);
export const getProjectsByCategory = (category) =>
  Object.values(projects).filter((project) => project.category === category);
