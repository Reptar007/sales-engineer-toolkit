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
