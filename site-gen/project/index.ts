import { project as cycleProject } from './cycle';
import { project as genericProject } from './generic';

const projects = {
  cycle: cycleProject,
  generic: genericProject,
} as const;

const key = (process.env.SITE_PROJECT || 'cycle') as keyof typeof projects;
if (!projects[key]) throw new Error(`Unknown SITE_PROJECT=${process.env.SITE_PROJECT}. Expected one of: ${Object.keys(projects).join(', ')}`);

export const project = projects[key];
