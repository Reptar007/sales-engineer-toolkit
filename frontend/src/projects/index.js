/**
 * Project Registry - Central registry for all available projects
 * Add new projects here to make them available in the app
 */

import SalesforceMetrics from './salesforce-metrics';
import RatioEstimator from './ratio-estimator';

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
    name: 'Opp PDF Builder',
    description: 'Build a polished PDF brief for an opportunity',
    icon: '📄',
    component: RatioEstimator,
    path: '/ratio-estimator',
    category: 'Tools',
    version: '1.0.0',
    features: ['File Upload', 'AI Estimation', 'Review & Approval', 'Export Results'],
  },
  // Note: 'flow-doc-generator' was unregistered — folder + backend route
  // left on disk so it can be revived by re-adding the import + entry here.
};

export const getProject = (projectId) => projects[projectId];
export const getAllProjects = () => Object.values(projects);
export const getProjectsByCategory = (category) =>
  Object.values(projects).filter((project) => project.category === category);
