/**
 * Project Registry - Central registry for all available projects
 * Add new projects here to make them available in the app
 */

import SalesforceMetrics from './salesforce-metrics';

export const projects = {
  'salesforce-metrics': {
    id: 'salesforce-metrics',
    name: 'Salesforce Metrics',
    description: 'Track and analyze your Salesforce performance',
    icon: '📈',
    component: SalesforceMetrics,
    path: '/salesforce-metrics',
    category: 'Analytics',
    version: '1.0.0',
    features: ['Data Analysis', 'Reporting', 'Visualization', 'Export Results'],
  },
  // Add more projects here as you create them
  // 'ratio-estimator': { ... }
};

export const getProject = (projectId) => projects[projectId];
export const getAllProjects = () => Object.values(projects);
export const getProjectsByCategory = (category) =>
  Object.values(projects).filter((project) => project.category === category);
