// Shared formatters / pickers used by the Opportunity detail card. Kept in a
// separate file from the React components so React Fast Refresh can re-mount
// the components without invalidating these helpers (and to satisfy
// `react-refresh/only-export-components`).

export const formatCurrency = (amount) => {
  if (amount === null || amount === undefined) return 'N/A';
  const n = Number(amount);
  if (Number.isNaN(n)) return 'N/A';
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

/** CARR column: dedicated field (env) → ARR__c (`arr`) → Gross ARR → Amount. */
export const lookupPrimaryRevenue = (opp) => opp.carr ?? opp.arr ?? opp.grossARR ?? opp.amount;

export const lookupShowGrossARRRow = (opp) => {
  if (opp.grossARR == null) return false;
  const primary = lookupPrimaryRevenue(opp);
  if (primary == null) return false;
  return Number(opp.grossARR) !== Number(primary);
};

export const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString();
};

export const formatDateTime = (dateString) => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleString();
};

// AE notes often arrive as "header text 12/15: more text" because SEs paste
// chronologically. Insert a newline before any date prefix so the rich-text
// renderer puts each dated update on its own paragraph.
export const formatNotesWithDates = (text) => {
  if (!text) return '';
  let formatted = text.replace(/([ \t])(\d{1,2}\/\d{1,2}:)/g, '\n$2');
  formatted = formatted.replace(/\n{3,}/g, '\n\n');
  return formatted;
};

export const formatGongDuration = (duration) => {
  if (!duration) return 'N/A';
  if (typeof duration === 'string' && duration.includes(':')) return duration;
  if (typeof duration === 'number') {
    const mins = Math.floor(duration);
    const secs = Math.round((duration - mins) * 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  return 'N/A';
};

export const STAGES = [
  { id: 1, name: '1. Discovery', key: 'Discovery' },
  { id: 2, name: '2. Evaluation', key: 'Evaluation' },
  { id: 3, name: '3. Proposal', key: 'Proposal' },
  { id: 4, name: '4. Contracting', key: 'Contracting' },
  { id: 5, name: 'Closed', key: 'Closed' },
];
