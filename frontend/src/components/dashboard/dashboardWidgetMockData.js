/** Replace with Google Calendar API / backend when ready */
export const MOCK_CALENDAR_EVENTS = [
  {
    id: '1',
    time: '9:00 AM',
    title: 'Team Kirby standup',
    meta: 'Google Meet',
    color: '#3b82f6',
  },
  {
    id: '2',
    time: '11:00 AM',
    title: 'Frontera Health demo',
    meta: 'Zoom · 45 min',
    color: '#a855f7',
  },
  {
    id: '3',
    time: '2:00 PM',
    title: 'Discovery: Everlaw',
    meta: 'Microsoft Teams · 30 min',
    color: '#22c55e',
  },
];

/**
 * Sample Linear board mirroring the real SE issue template:
 *   Opportunity Name: ...
 *   Main Ask: ...
 *   Contract Owner: ...   ← maps to AE
 *   Type of Ask: ...      ← rendered as the "↳" sub-line under the opp
 *   Due Date: YYYY-MM-DD
 *
 * Used by the Active Hunts widget as a dev-time fallback when the
 * Linear backend is unreachable, so the table still renders something
 * meaningful while iterating on the UI.
 */
export const MOCK_LINEAR_BOARD = {
  openUrl: 'https://linear.app',
  projects: [
    {
      id: 'ae-requests',
      name: 'AE Requests',
      issues: [
        {
          id: 'IGU-894',
          title: 'Exploratory Estimation - Web for North American Risk Services (NARS)',
          status: 'In progress',
          tone: 'progress',
          ae: 'Jordan',
          dueDate: '2026-04-28',
          oppName: 'North American Risk Services (NARS)',
          typeOfAsk: 'Exploratory Estimation - Web',
          accountScore: 'B',
          priority: 'urgent',
        },
        {
          id: 'IGU-902',
          title: 'POC Scoping for Frontera Health',
          status: 'In review',
          tone: 'review',
          ae: 'Becca',
          dueDate: '2026-05-04',
          oppName: 'Frontera Health',
          typeOfAsk: 'POC Scoping - Mobile',
          accountScore: 'A',
          priority: 'high',
        },
        {
          id: 'IGU-905',
          title: 'Discovery deep-dive — Everlaw renewal',
          status: 'Backlog',
          tone: 'backlog',
          ae: 'Sam',
          dueDate: null,
          oppName: 'Everlaw',
          typeOfAsk: 'Discovery deep-dive',
          accountScore: 'C',
        },
        {
          id: 'IGU-910',
          title: 'Build live AI demo for Bowser Industries renewal',
          status: 'AI Demo',
          tone: 'ai-demo',
          ae: 'Peach',
          dueDate: '2026-05-06',
          oppName: 'Bowser Industries',
          typeOfAsk: 'Live AI demo build',
          accountScore: 'A',
          priority: 'high',
          isAiDemo: true,
        },
      ],
    },
    {
      id: 'csm-requests',
      name: 'CSM Requests',
      issues: [
        {
          id: 'IGU-871',
          title: 'Talking points for ControlD QBR',
          status: 'In progress',
          tone: 'progress',
          ae: 'Priya',
          dueDate: '2026-04-30',
          oppName: 'ControlD',
          typeOfAsk: 'QBR talking points',
          accountScore: 'A',
          priority: 'medium',
        },
        {
          id: 'IGU-878',
          title: 'Acme rollout summary deck',
          status: 'Backlog',
          tone: 'backlog',
          ae: null,
          dueDate: null,
          oppName: 'Acme Corporation',
          typeOfAsk: 'Renewal deck',
          accountScore: null,
        },
      ],
    },
    {
      id: 'creations-tasks',
      name: 'Creations Tasks',
      issues: [
        {
          id: 'IGU-815',
          title: 'Build Playwright POC for Front Health Insurance customer journey',
          status: 'In progress',
          tone: 'progress',
          ae: null,
          dueDate: '2026-05-02',
          oppName: 'Front Health Insurance',
          typeOfAsk: 'Playwright POC build',
          accountScore: 'B',
        },
        {
          id: 'IGU-822',
          title: 'Flow Doc Generator v1.1 QA pass',
          status: 'In review',
          tone: 'review',
          ae: 'Alex',
          dueDate: null,
          oppName: 'Internal — Flow Doc Generator',
          typeOfAsk: 'QA pass for v1.1 release',
          accountScore: null,
        },
      ],
    },
  ],
};
