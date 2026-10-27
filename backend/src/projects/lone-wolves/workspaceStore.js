/**
 * Lone Wolves -- the page's own record of each workspace, in this app's
 * database (OnboardingWorkspace): the details the platform cannot say, and
 * the workspaces added by hand.
 *
 * `normalizeDetails` is the one gate every write passes through, so a bad
 * date or a free-text segment never reaches the table.
 */
import { getPrisma } from '../../lib/prisma.js';
import { SEGMENTS } from './onboardingShape.js';
import { PRICINGS } from './usageShape.js';

let prismaOverride = null;

/** Test hook: use this client instead of the app's. */
export function setOnboardingPrismaForTests(client) {
  prismaOverride = client;
}

const db = async () => prismaOverride || getPrisma();

export class OnboardingError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const TEXT_MAX = 120;
const NEXT_STEP_MAX = 500;
const SAFE_ID = /^[a-z0-9]{10,64}$/;
const LINEAR_ID = /^[A-Z][A-Z0-9]*-\d+$/;

export function isWorkspaceId(value) {
  return SAFE_ID.test(String(value || ''));
}

function text(value, field, max = TEXT_MAX) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new OnboardingError('ONBOARDING_INVALID', `${field} is longer than ${max} characters.`);
  }
  return trimmed;
}

/**
 * The writable fields of a request body, checked and converted. Fields the
 * body leaves out are left out here too, so a save changes only what it
 * names; an empty string or null clears a field.
 */
export function normalizeDetails(body = {}) {
  const out = {};
  if ('workspaceName' in body) out.workspaceName = text(body.workspaceName, 'Name');
  if ('environmentId' in body) {
    if (body.environmentId && !SAFE_ID.test(body.environmentId)) {
      throw new OnboardingError('ONBOARDING_INVALID', 'That is not a QA Wolf environment id.');
    }
    out.environmentId = body.environmentId || null;
  }
  if ('segment' in body) {
    if (body.segment != null && body.segment !== '' && !SEGMENTS.includes(body.segment)) {
      throw new OnboardingError(
        'ONBOARDING_INVALID',
        `Type must be one of ${SEGMENTS.join(', ')}.`,
      );
    }
    out.segment = body.segment || null;
  }
  if ('kickoffOn' in body) {
    if (!body.kickoffOn) out.kickoffOn = null;
    else if (
      !/^\d{4}-\d{2}-\d{2}$/.test(body.kickoffOn) ||
      Number.isNaN(Date.parse(body.kickoffOn))
    ) {
      throw new OnboardingError('ONBOARDING_INVALID', 'Kickoff must be a YYYY-MM-DD date.');
    } else out.kickoffOn = new Date(`${body.kickoffOn}T00:00:00.000Z`);
  }
  if ('pilotDays' in body) {
    if (body.pilotDays == null || body.pilotDays === '') out.pilotDays = null;
    else {
      const days = Number(body.pilotDays);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw new OnboardingError('ONBOARDING_INVALID', 'Pilot length must be 1 to 365 days.');
      }
      out.pilotDays = days;
    }
  }
  if ('linearIssue' in body) {
    const issue = text(body.linearIssue, 'Linear ticket');
    if (issue && !LINEAR_ID.test(issue.toUpperCase())) {
      throw new OnboardingError('ONBOARDING_INVALID', 'Linear ticket must look like AXO-1275.');
    }
    out.linearIssue = issue ? issue.toUpperCase() : null;
  }
  for (const [key, label] of [
    ['ae', 'AE'],
    ['csm', 'CSM'],
    ['failureOwner', 'Failure owner'],
  ]) {
    if (key in body) out[key] = text(body[key], label);
  }
  if ('nextStep' in body) out.nextStep = text(body.nextStep, 'Next step', NEXT_STEP_MAX);
  if ('clientBuildingTests' in body) {
    const value = body.clientBuildingTests;
    if (value !== null && value !== true && value !== false) {
      throw new OnboardingError(
        'ONBOARDING_INVALID',
        'Client building tests must be true, false or null.',
      );
    }
    out.clientBuildingTests = value;
  }
  if ('hidden' in body) out.hidden = body.hidden === true;
  if ('pricing' in body) {
    if (body.pricing != null && !PRICINGS.includes(body.pricing)) {
      throw new OnboardingError(
        'ONBOARDING_INVALID',
        `Pricing must be one of ${PRICINGS.join(', ')}.`,
      );
    }
    out.pricing = body.pricing ?? null;
  }
  return out;
}

const viewerName = (viewer) => viewer?.name || viewer?.email || viewer?.username || null;

/** Every recorded workspace, hidden ones included (the service drops them). */
export async function listDetails() {
  const prisma = await db();
  return prisma.onboardingWorkspace.findMany();
}

/** A finished week's stored usage, or null when it has not been counted yet. */
export async function getUsageWeek(workspaceId, environmentId, weekStart) {
  const prisma = await db();
  return prisma.onboardingUsageWeek.findUnique({
    where: {
      workspaceId_environmentId_weekStart: {
        workspaceId,
        environmentId,
        weekStart: new Date(weekStart),
      },
    },
  });
}

/** Keep a finished week's usage; counting it again would read every run. */
export async function saveUsageWeek(workspaceId, environmentId, weekStart, usage) {
  const prisma = await db();
  const data = {
    runs: usage.runs,
    flowRuns: usage.flowRuns,
    attempts: usage.attempts,
    runnerSeconds: usage.runnerSeconds,
    credits: usage.credits,
  };
  return prisma.onboardingUsageWeek.upsert({
    where: {
      workspaceId_environmentId_weekStart: {
        workspaceId,
        environmentId,
        weekStart: new Date(weekStart),
      },
    },
    create: { workspaceId, environmentId, weekStart: new Date(weekStart), ...data },
    update: data,
  });
}

/** Record details for a workspace, creating its row on first save. */
export async function saveDetails(workspaceId, body, viewer) {
  if (!isWorkspaceId(workspaceId)) {
    throw new OnboardingError('ONBOARDING_INVALID', 'That is not a QA Wolf workspace id.');
  }
  const data = { ...normalizeDetails(body), updatedBy: viewerName(viewer) };
  const prisma = await db();
  return prisma.onboardingWorkspace.upsert({
    where: { workspaceId },
    create: { workspaceId, ...data },
    update: data,
  });
}

/**
 * Put a workspace from another QA team on the page. Adding one that is
 * already recorded un-hides it and marks it as added by hand.
 */
export async function addWorkspace(workspaceId, body, viewer) {
  if (!isWorkspaceId(workspaceId)) {
    throw new OnboardingError('ONBOARDING_INVALID', 'That is not a QA Wolf workspace id.');
  }
  const data = {
    ...normalizeDetails(body),
    addedManually: true,
    hidden: false,
    updatedBy: viewerName(viewer),
  };
  const prisma = await db();
  return prisma.onboardingWorkspace.upsert({
    where: { workspaceId },
    create: { workspaceId, ...data },
    update: data,
  });
}
