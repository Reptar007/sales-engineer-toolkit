import { getPrisma } from '../../lib/prisma.js';

/**
 * Build a config-compatible quarterly goals array for one year.
 * @param {number} year
 * @param {Map<number, number>} quarterToGoal
 * @returns {{ value: number, label: string, goal: number }[]}
 */
function buildYearGoals(year, quarterToGoal) {
  return [1, 2, 3, 4].map((quarter) => ({
    value: quarter,
    label: `Q${quarter} CY${year}`,
    goal: quarterToGoal.get(quarter) ?? 0,
  }));
}

/**
 * Load goals from DB and return config-compatible structure:
 * {
 *   [year]: [
 *     { value: 1, label: 'Q1 CY2026', goal: 0 },
 *     ...
 *   ]
 * }
 *
 * @returns {Promise<Record<string, { value: number, label: string, goal: number }[]>>}
 */
export async function getGoalsByYearFromDb() {
  const prisma = await getPrisma();
  const rows = await prisma.quarterlyGoal.findMany({
    orderBy: [{ year: 'asc' }, { quarter: 'asc' }],
  });

  const byYear = new Map();
  for (const row of rows) {
    if (!byYear.has(row.year)) {
      byYear.set(row.year, new Map());
    }
    byYear.get(row.year).set(row.quarter, row.goal);
  }

  const goalsByYear = {};
  for (const [year, quarterToGoal] of byYear.entries()) {
    goalsByYear[year] = buildYearGoals(year, quarterToGoal);
  }

  return goalsByYear;
}

/**
 * Get config-compatible quarterly goals for one year.
 * Missing quarters are returned with goal = 0.
 *
 * @param {number} year
 * @returns {Promise<{ value: number, label: string, goal: number }[]>}
 */
export async function getGoalsForYear(year) {
  const prisma = await getPrisma();
  const rows = await prisma.quarterlyGoal.findMany({
    where: { year },
    orderBy: [{ quarter: 'asc' }],
  });

  const quarterToGoal = new Map();
  for (const row of rows) {
    quarterToGoal.set(row.quarter, row.goal);
  }

  return buildYearGoals(year, quarterToGoal);
}

/**
 * Upsert quarterly goals for a year in a single transaction.
 *
 * @param {number} year
 * @param {{ quarter: number, goal: number }[]} goals
 * @returns {Promise<{ value: number, label: string, goal: number }[]>}
 */
export async function upsertGoalsForYear(year, goals) {
  const prisma = await getPrisma();

  await prisma.$transaction(
    goals.map((g) =>
      prisma.quarterlyGoal.upsert({
        where: {
          year_quarter: {
            year,
            quarter: g.quarter,
          },
        },
        update: { goal: g.goal },
        create: {
          year,
          quarter: g.quarter,
          goal: g.goal,
        },
      }),
    ),
  );

  return getGoalsForYear(year);
}
