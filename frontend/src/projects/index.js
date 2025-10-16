/**
 * Project Registry - Central registry for all available projects
 * Add new projects here to make them available in the app
 */

// import RatioEstimator from './ratio-estimator';

export const projects = {
  // Temporarily disabled while fixing import issues
  // 'ratio-estimator': {
  //   id: 'ratio-estimator',
  //   name: 'Ratio Estimator',
  //   description: 'AI-powered test ratio estimation tool',
  //   icon: '📊',
  //   component: RatioEstimator,
  //   path: '/ratio-estimator',
  //   category: 'Analysis Tools',
  //   version: '1.0.0',
  //   features: ['CSV Upload', 'AI Processing', 'Review & Approval', 'Export Results']
  // }
  // Add more projects here as you create them
  // 'project-template': { ... }
};

export const getProject = (projectId) => projects[projectId];
export const getAllProjects = () => Object.values(projects);
export const getProjectsByCategory = (category) =>
  Object.values(projects).filter((project) => project.category === category);
