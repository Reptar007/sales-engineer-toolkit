import { useEffect, useState } from 'react';
import { fetchDashboardCalendar, fetchDashboardLinear } from '../services/api';

/**
 * useDashboardSummary
 *
 * Fetches today's calendar + the user's Linear workload and reduces them to
 * the small set of counts the dashboard hero cares about:
 *
 *   - meetingsToday : Google Calendar events flagged as real meetings by the
 *                     backend (has video conf link / >1 attendee). Personal
 *                     time blocks like "Home", "Lunch", solo focus time, and
 *                     all-day events do NOT count.
 *   - activeHunts   : Linear issues that are actively in flight — i.e. NOT
 *                     blocked, paused, AI-demo-tagged, canceled, or done.
 *                     (Canceled / done are already filtered server-side, so
 *                     here we just additionally exclude blocked/paused and
 *                     AI demos.) Powers the "N active hunts" pill on the
 *                     right side of the hero.
 *   - inProgress    : Linear issues whose tone is 'progress'. Kept for
 *                     consumers that specifically want the "in progress"
 *                     subset (not surfaced in the hero anymore).
 *   - highPriority  : Linear issues with priority === 'urgent' or 'high'.
 *                     Both tones get highlighted in the Active Hunts table,
 *                     so we lump them together as one "needs attention" count.
 *   - aiDemo        : Linear issues tagged with the "AI Demo" label
 *   - blocked       : Linear issues whose status matches /blocked|paused/i
 *                     (Blocked / Paused / Access Blocked — Linear marks these
 *                      with state.type === 'unstarted', so we filter on the
 *                      original status name rather than the 'tone' field)
 *
 * Returns:
 *   {
 *     meetingsToday, activeHunts, inProgress, highPriority, aiDemo, blocked,
 *     ready,        // true once both fetches have settled
 *     hasCalendar,  // calendar integration is connected
 *     hasLinear,    // linear data is available (status === 'ok')
 *   }
 */
const BLOCKED_RE = /blocked|paused/i;
const HIGH_PRIORITY_RE = /^(urgent|high)$/i;

export default function useDashboardSummary() {
  const [state, setState] = useState({
    meetingsToday: 0,
    activeHunts: 0,
    inProgress: 0,
    highPriority: 0,
    aiDemo: 0,
    blocked: 0,
    ready: false,
    hasCalendar: false,
    hasLinear: false,
  });

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([fetchDashboardCalendar(), fetchDashboardLinear()])
      .then(([calRes, linRes]) => {
        if (cancelled) return;

        let meetingsToday = 0;
        let hasCalendar = false;
        if (calRes.status === 'fulfilled' && calRes.value?.configured) {
          hasCalendar = true;
          const events = Array.isArray(calRes.value.events) ? calRes.value.events : [];
          // Backend flags real meetings via isMeeting (>1 attendee or video link).
          // Personal time blocks (Home, Lunch, focus time) come back with
          // isMeeting === false and are intentionally not counted here.
          meetingsToday = events.filter((ev) => ev.isMeeting).length;
        }

        let activeHunts = 0;
        let inProgress = 0;
        let highPriority = 0;
        let aiDemo = 0;
        let blocked = 0;
        let hasLinear = false;
        if (linRes.status === 'fulfilled' && linRes.value?.configured) {
          hasLinear = true;
          const projects = Array.isArray(linRes.value.projects) ? linRes.value.projects : [];
          for (const project of projects) {
            const issues = Array.isArray(project.issues) ? project.issues : [];
            for (const issue of issues) {
              const isBlocked = typeof issue.status === 'string' && BLOCKED_RE.test(issue.status);
              if (isBlocked) blocked += 1;
              if (issue.isAiDemo) aiDemo += 1;
              // "Active" = anything in flight that the SE can actually work
              // on right now. Blocked/paused issues are waiting on someone
              // else, AI demos get their own callout, and canceled/done are
              // already filtered out server-side.
              if (!isBlocked && !issue.isAiDemo) activeHunts += 1;
              if (issue.tone === 'progress') inProgress += 1;
              if (typeof issue.priority === 'string' && HIGH_PRIORITY_RE.test(issue.priority)) {
                highPriority += 1;
              }
            }
          }
        }

        setState({
          meetingsToday,
          activeHunts,
          inProgress,
          highPriority,
          aiDemo,
          blocked,
          ready: true,
          hasCalendar,
          hasLinear,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState((prev) => ({ ...prev, ready: true }));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
