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

/** Replace with Linear API / backend when ready — grouped by Linear project */
export const MOCK_LINEAR_BOARD = {
  openUrl: 'https://linear.app',
  projects: [
    {
      id: 'ae-requests',
      name: 'AE Requests',
      issues: [
        {
          id: 'ae-1',
          title: 'Frontera Health — demo script & env checklist',
          status: 'In progress',
          tone: 'progress',
        },
        {
          id: 'ae-2',
          title: 'Everlaw discovery — scope questions for AE',
          status: 'In review',
          tone: 'review',
        },
      ],
    },
    {
      id: 'creations-tasks',
      name: 'Creations Tasks',
      issues: [
        {
          id: 'cr-1',
          title: 'Build Playwright POC for Front…',
          status: 'In progress',
          tone: 'progress',
        },
        {
          id: 'cr-2',
          title: 'Flow Doc Generator v1.1 QA',
          status: 'In review',
          tone: 'review',
        },
      ],
    },
    {
      id: 'csm-requests',
      name: 'CSM Requests',
      issues: [
        {
          id: 'csm-1',
          title: 'ControlD talking points doc',
          status: 'Backlog',
          tone: 'backlog',
        },
        {
          id: 'csm-2',
          title: 'Renewal deck: Acme rollout summary',
          status: 'In progress',
          tone: 'progress',
        },
      ],
    },
  ],
};
