/**
 * Quarterly Closed-Won CARR breakdown — shared data + PDF builder.
 *
 * Powers both the CLI script (`scripts/generate-quarter-carr-pdf.js`) and the
 * HTTP endpoint used by the Alpha Pack → Quarterly Goals tab so the report is
 * byte-for-byte identical no matter how it's produced.
 *
 * The report, for one quarter:
 *   - Total goal-eligible CARR attained, matching the dashboard's headline
 *     CARR exactly (same goalEligibility.js predicate, no local copy)
 *   - The New Business / Expansion split behind that total
 *   - Which composition the quarter counts (New Business only before the
 *     Q3 CY2026 cutover, New Business + Expansion after it)
 *   - The quarterly goal (DB override, falling back to config)
 *   - Attainment percentage vs. goal
 *   - A per-opportunity breakdown of every closed-won deal
 */
import PDFDocument from 'pdfkit';
import { getMetricsQuarterlyDataForYear } from '../projects/salesforce/metricsForYear.js';
import { summarizeQuarter, typeBucket } from '../projects/salesforce/goalEligibility.js';
import { getGoalsForYear } from '../projects/salesforce/goalsService.js';
import { getSalesforceConfig } from '../config/salesforce.js';

function usd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Resolve a single quarter's goal: config goals overridden by any DB-stored
 * goal for the year (same precedence the /config route applies).
 * @param {number} year
 * @param {number} quarterNum 1-4
 * @returns {Promise<number>}
 */
async function resolveQuarterGoal(year, quarterNum) {
  const config = getSalesforceConfig();
  const configGoals = config.goalsByYear?.[year] || [];
  const goalByQuarter = new Map(configGoals.map((g) => [g.value, g.goal]));

  try {
    const dbGoals = await getGoalsForYear(year);
    for (const g of dbGoals) {
      if (Number.isFinite(g.goal) && g.goal > 0) goalByQuarter.set(g.value, g.goal);
    }
  } catch (err) {
    console.warn('quarter-carr: goal DB load failed, using config only -', err.message);
  }
  return goalByQuarter.get(quarterNum) || 0;
}

/**
 * Build the report data for one quarter.
 * @param {number} year
 * @param {number} quarterNum 1-4
 * @returns {Promise<{
 *   year: number, quarterNum: number, quarterKey: string,
 *   opps: object[], totalCARR: number, goal: number,
 *   pct: number|null, excludedCount: number,
 * }>}
 */
export async function getQuarterCarrReport(year, quarterNum) {
  const quarterly = await getMetricsQuarterlyDataForYear(year);
  if (!quarterly) {
    const err = new Error(
      `No metrics available for ${year}. Add a snapshot or a metrics report ID for the year.`,
    );
    err.code = 'NO_METRICS';
    throw err;
  }

  // Quarter labels come back like "Q2 CY2026"; match on the quarter number.
  const quarterKey = Object.keys(quarterly).find(
    (k) => k !== 'Total' && new RegExp(`Q${quarterNum}\\b`, 'i').test(k),
  );
  if (!quarterKey) {
    const err = new Error(
      `Could not find Q${quarterNum} in ${year} data. Available: ${Object.keys(quarterly)
        .filter((k) => k !== 'Total')
        .join(', ')}`,
    );
    err.code = 'NO_QUARTER';
    throw err;
  }

  const allOpps = quarterly[quarterKey].opportunities || [];
  // Eligibility is decided upstream (goalEligibility.js): C-score exclusions,
  // leadership exceptions, and whether the opportunity's type counts toward
  // the goal in this quarter. This service deliberately keeps no copy of those
  // rules -- a local copy is exactly how this PDF and the dashboard came to
  // disagree about `C-` scored deals.
  const opps = allOpps
    .filter((opp) => opp.goalEligible)
    .sort((a, b) => (b.carrAmount || 0) - (a.carrAmount || 0));

  const summary = summarizeQuarter(allOpps, quarterKey);
  const totalCARR = summary.totalCARR;
  const goal = await resolveQuarterGoal(year, quarterNum);
  const pct = goal > 0 ? (totalCARR / goal) * 100 : null;

  return {
    year,
    quarterNum,
    quarterKey,
    opps,
    totalCARR,
    goal,
    pct,
    excludedCount: summary.excludedCount,
    carrByType: summary.carrByType,
    countByType: summary.countByType,
    composition: summary.composition,
    unrecognizedTypes: summary.unrecognizedTypes,
  };
}

/**
 * A filename-safe default for the report, e.g. "Q2-2026-CARR-breakdown.pdf".
 */
export function getReportFilename(report) {
  return `Q${report.quarterNum}-${report.year}-CARR-breakdown.pdf`;
}

/**
 * Render the report as a PDF into a writable stream (HTTP response or file).
 * Resolves when the stream has fully flushed.
 * @param {import('stream').Writable} writableStream
 * @param {Awaited<ReturnType<typeof getQuarterCarrReport>>} report
 * @returns {Promise<void>}
 */
export function streamQuarterCarrPdf(writableStream, report) {
  const { quarterKey, opps, totalCARR, goal, pct, excludedCount, carrByType, composition } = report;

  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    doc.pipe(writableStream);
    writableStream.on('finish', resolvePromise);
    writableStream.on('error', reject);
    doc.on('error', reject);

    const navy = '#0f2a43';
    const teal = '#0e8f8f';
    const coral = '#e2574c';
    const slate = '#5b6b7a';
    const light = '#eef2f5';

    const pageLeft = doc.page.margins.left;
    const pageRight = doc.page.width - doc.page.margins.right;
    const contentWidth = pageRight - pageLeft;

    // Header
    doc.rect(0, 0, doc.page.width, 96).fill(navy);
    doc
      .fillColor('#9fd0d0')
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('TROPHY ROOM  •  CLOSED-WON CARR', pageLeft, 30, { characterSpacing: 1 });
    doc
      .fillColor('#ffffff')
      .fontSize(22)
      .font('Helvetica-Bold')
      .text(`${quarterKey} — CARR Breakdown`, pageLeft, 46);
    doc
      .fillColor('#9fb3c4')
      .fontSize(9)
      .font('Helvetica')
      .text(
        `Counting ${composition?.label || 'New Business'}  •  Generated ${new Date().toLocaleDateString(
          'en-US',
          { year: 'numeric', month: 'long', day: 'numeric' },
        )}`,
        pageLeft,
        74,
      );

    // Summary cards
    let y = 126;
    const gap = 14;
    const cardW = (contentWidth - gap * 2) / 3;
    const cardH = 82;

    const cards = [
      { label: 'CARR ATTAINED', value: usd(totalCARR), accent: teal },
      { label: 'QUARTER GOAL', value: goal > 0 ? usd(goal) : 'Not set', accent: navy },
      {
        label: 'GOAL ATTAINMENT',
        value: pct == null ? 'N/A' : `${pct.toFixed(1)}%`,
        accent: pct == null ? slate : pct >= 100 ? teal : pct >= 80 ? '#c99a2e' : coral,
      },
    ];

    cards.forEach((card, i) => {
      const x = pageLeft + i * (cardW + gap);
      doc.roundedRect(x, y, cardW, cardH, 8).fill(light);
      doc.rect(x, y, 5, cardH).fill(card.accent);
      doc
        .fillColor(slate)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(card.label, x + 16, y + 16, { width: cardW - 24, characterSpacing: 0.5 });
      doc
        .fillColor(card.accent)
        .font('Helvetica-Bold')
        .fontSize(19)
        .text(card.value, x + 16, y + 36, { width: cardW - 24 });
    });

    y += cardH + 20;

    // Per-type split. Only worth drawing when the quarter actually counts more
    // than one stream -- before the cutover every dollar is New Business and a
    // one-segment bar says nothing.
    const typeEntries = Object.entries(carrByType || {}).filter(([, amount]) => amount > 0);
    if (typeEntries.length > 1 && totalCARR > 0) {
      const streamColors = { 'New Business': navy, Expansion: '#c99a2e' };
      const barH = 14;
      doc
        .fillColor(slate)
        .font('Helvetica')
        .fontSize(9)
        .text('Composition of attained CARR', pageLeft, y);
      y += 15;

      let segX = pageLeft;
      typeEntries.forEach(([bucket, amount], i) => {
        const segW =
          i === typeEntries.length - 1
            ? pageLeft + contentWidth - segX
            : contentWidth * (amount / totalCARR);
        doc.rect(segX, y, Math.max(2, segW), barH).fill(streamColors[bucket] || slate);
        segX += segW;
      });
      y += barH + 8;

      // Legend, one line: swatch + name + amount + share.
      let legendX = pageLeft;
      doc.font('Helvetica').fontSize(8);
      typeEntries.forEach(([bucket, amount]) => {
        const share = ((amount / totalCARR) * 100).toFixed(1);
        const text = `${bucket}  ${usd(amount)}  (${share}%)`;
        const textW = doc.widthOfString(text) + 22;
        doc.rect(legendX, y + 1, 8, 8).fill(streamColors[bucket] || slate);
        doc.fillColor(slate).text(text, legendX + 12, y, { width: textW });
        legendX += textW;
      });
      y += 22;
    }

    // Progress bar toward goal
    if (goal > 0) {
      const barH = 16;
      const frac = Math.max(0, Math.min(1, totalCARR / goal));
      doc.fillColor(slate).font('Helvetica').fontSize(9).text('Progress to goal', pageLeft, y);
      y += 15;
      doc.roundedRect(pageLeft, y, contentWidth, barH, 5).fill(light);
      const fillW = Math.max(4, contentWidth * frac);
      const barColor = frac >= 1 ? teal : frac >= 0.8 ? '#c99a2e' : coral;
      doc.roundedRect(pageLeft, y, fillW, barH, 5).fill(barColor);
      doc
        .fillColor(navy)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(`${(frac * 100).toFixed(1)}%`, pageLeft, y + 4, {
          width: contentWidth - 8,
          align: 'right',
        });
      y += barH + 22;
    }

    // Table title
    doc
      .fillColor(navy)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(`Closed-Won Opportunities (${opps.length})`, pageLeft, y);
    y += 22;

    // Table columns: Opportunity | AE | Score | CARR
    const cols = {
      opp: { x: pageLeft, w: contentWidth * 0.36, label: 'Opportunity' },
      ae: { x: 0, w: contentWidth * 0.24, label: 'Account Executive' },
      type: { x: 0, w: contentWidth * 0.14, label: 'Type' },
      score: { x: 0, w: contentWidth * 0.09, label: 'Score' },
      carr: { x: 0, w: contentWidth * 0.17, label: 'CARR' },
    };
    cols.ae.x = cols.opp.x + cols.opp.w;
    cols.type.x = cols.ae.x + cols.ae.w;
    cols.score.x = cols.type.x + cols.type.w;
    cols.carr.x = cols.score.x + cols.score.w;

    const drawHeader = () => {
      doc.rect(pageLeft, y, contentWidth, 22).fill(navy);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
      doc.text(cols.opp.label, cols.opp.x + 8, y + 7, { width: cols.opp.w - 10 });
      doc.text(cols.ae.label, cols.ae.x + 4, y + 7, { width: cols.ae.w - 8 });
      doc.text(cols.type.label, cols.type.x + 4, y + 7, { width: cols.type.w - 8 });
      doc.text(cols.score.label, cols.score.x + 4, y + 7, { width: cols.score.w - 8 });
      doc.text(cols.carr.label, cols.carr.x + 4, y + 7, {
        width: cols.carr.w - 12,
        align: 'right',
      });
      y += 22;
    };

    drawHeader();

    doc.font('Helvetica').fontSize(9);
    let zebra = false;
    const rowPadV = 6;

    if (opps.length === 0) {
      doc
        .fillColor(slate)
        .text('No closed-won opportunities for this quarter.', pageLeft + 8, y + 8);
      y += 28;
    }

    for (const opp of opps) {
      const oppName = opp.opportunityName || '(unnamed)';
      const aeName = opp.aeName || '—';
      const score = opp.accountScore || '—';
      // Rows captured before the Type column existed have no type; show a dash
      // rather than implying they were classified.
      const typeText = typeBucket(opp) === 'Unspecified' ? '—' : typeBucket(opp);
      const carrText = usd(opp.carrAmount);

      const oppH = doc.heightOfString(oppName, { width: cols.opp.w - 12 });
      const aeH = doc.heightOfString(aeName, { width: cols.ae.w - 8 });
      const rowH = Math.max(oppH, aeH, 11) + rowPadV * 2;

      // Page break
      if (y + rowH > doc.page.height - doc.page.margins.bottom - 40) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader();
        doc.font('Helvetica').fontSize(9);
      }

      if (zebra) doc.rect(pageLeft, y, contentWidth, rowH).fill(light);
      zebra = !zebra;

      doc.fillColor('#1c2b38').font('Helvetica').fontSize(9);
      doc.text(oppName, cols.opp.x + 8, y + rowPadV, { width: cols.opp.w - 12 });
      doc.text(aeName, cols.ae.x + 4, y + rowPadV, { width: cols.ae.w - 8 });
      doc
        .fillColor(typeText === 'Expansion' ? '#8a6a1f' : slate)
        .text(typeText, cols.type.x + 4, y + rowPadV, { width: cols.type.w - 8 });
      doc.fillColor(slate).text(score, cols.score.x + 4, y + rowPadV, { width: cols.score.w - 8 });
      doc
        .fillColor(navy)
        .font('Helvetica-Bold')
        .text(carrText, cols.carr.x + 4, y + rowPadV, {
          width: cols.carr.w - 12,
          align: 'right',
        });

      y += rowH;
    }

    // Total row
    if (opps.length > 0) {
      if (y + 26 > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.rect(pageLeft, y, contentWidth, 24).fill(teal);
      doc
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('TOTAL', cols.opp.x + 8, y + 7, { width: cols.opp.w });
      doc.text(usd(totalCARR), cols.carr.x + 4, y + 7, {
        width: cols.carr.w - 12,
        align: 'right',
      });
      y += 24;
    }

    // Footnote
    y += 16;
    doc
      .fillColor(slate)
      .font('Helvetica-Oblique')
      .fontSize(7.5)
      .text(
        `CARR reflects goal-eligible closed-won opportunities for ${quarterKey}, counting ` +
          `${composition?.label || 'New Business'}. C-scored accounts are excluded ` +
          (excludedCount > 0 ? `(${excludedCount} row(s) excluded this quarter) ` : '') +
          'unless granted an explicit goal-inclusion exception. Opportunity types outside this ' +
          "quarter's composition are excluded too, which is why quarters either side of a " +
          'composition change are not directly comparable. Matches the Salesforce Metrics dashboard.',
        pageLeft,
        y,
        { width: contentWidth },
      );

    doc.end();
  });
}
