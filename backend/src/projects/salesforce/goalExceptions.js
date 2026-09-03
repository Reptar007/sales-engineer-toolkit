/**
 * Goal-inclusion exceptions.
 *
 * By default a closed-won opp whose Account Score is "C" is excluded from
 * goal-eligible CARR (see the C filters in `index.js` and
 * `services/packCarrService.js`). Occasionally leadership grants an explicit
 * exception so a specific deal still counts toward the quarterly goal even
 * though it scored C.
 *
 * Matches are keyed off the Salesforce Opportunity Id when known (stable and
 * unambiguous), with an opportunity-name fallback for safety. To grant a new
 * exception, add an entry here — every C-exclusion site imports `isGoalException`
 * so a single entry covers the live report, pack CARR, and the frontend.
 */
export const GOAL_INCLUSION_EXCEPTIONS = [
  {
    // Synergy Pet Group — C-scored but included in the goal per exception.
    label: 'Synergy Pet Group',
    opportunityId: '006PA00000QeictYAB',
    namePattern: /synergy pet/i,
  },
];

/**
 * True when an opportunity has an explicit goal-inclusion exception and should
 * therefore be counted toward goal CARR regardless of its Account Score.
 *
 * @param {{ opportunityId?: string, opportunityName?: string }} opp
 * @returns {boolean}
 */
export function isGoalException(opp) {
  if (!opp) return false;
  const id = (opp.opportunityId || '').trim();
  const name = (opp.opportunityName || '').trim();
  return GOAL_INCLUSION_EXCEPTIONS.some((ex) => {
    if (ex.opportunityId && id && ex.opportunityId === id) return true;
    if (ex.namePattern && name && ex.namePattern.test(name)) return true;
    return false;
  });
}
