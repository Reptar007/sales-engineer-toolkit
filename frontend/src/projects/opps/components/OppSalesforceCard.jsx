import React from 'react';
import {
  formatCurrency,
  formatDate,
  lookupPrimaryRevenue,
  lookupShowGrossARRRow,
} from '../../salesforce/lookup/opportunityHelpers';
import { renderRichText } from '../../salesforce/lookup/richText.jsx';

// Slimmed-down Salesforce summary tuned for the Hunt Board handoff page.
// The standalone Salesforce Lookup page still uses the full
// `OpportunityDetailsCard`; this component intentionally drops fields the
// handoff doc doesn't need (no stage scrollbar, no description / next-step
// block, no AE Notes) and re-orders Basic Information so the things a Lead
// scans first (Owner, Product, Stage, CARR) are at the top.
//
// Gong is rendered as its own sibling card (see `OppGongCard`), not inside
// this component, so the right rail reads as discrete "data sources".

function Row({ label, value }) {
  return (
    <div className="lookup-detail-item">
      <span className="lookup-detail-label">{label}</span>
      <span className="lookup-detail-value">{value || 'N/A'}</span>
    </div>
  );
}

function OppSalesforceCard({ opportunity }) {
  if (!opportunity) return null;
  return (
    <div className="lookup-full-details">
      <div className="lookup-detail-section">
        <div className="lookup-detail-grid">
          <Row label="Owner" value={opportunity.ownerName} />
          <Row label="Product" value={opportunity.product} />
          <Row label="Stage" value={opportunity.stage} />
          <Row label="Account Score" value={opportunity.accountScore} />
          <Row label="CARR" value={formatCurrency(lookupPrimaryRevenue(opportunity))} />
          {lookupShowGrossARRRow(opportunity) && (
            <Row label="Gross ARR" value={formatCurrency(opportunity.grossARR)} />
          )}
          <Row label="Close Date" value={formatDate(opportunity.closeDate)} />
          <Row
            label="Probability"
            value={
              opportunity.probability !== null && opportunity.probability !== undefined
                ? `${opportunity.probability}%`
                : 'N/A'
            }
          />
          {opportunity.champion && <Row label="Champion" value={opportunity.champion} />}
          {opportunity.championContactName && (
            <Row label="Champion Contact" value={opportunity.championContactName} />
          )}
          <Row label="Competitor" value={opportunity.competitor} />
          <Row label="Current QA Setup" value={opportunity.currentQASetup} />
          <Row label="Salesforce ID" value={opportunity.id} />
        </div>
      </div>

      {opportunity.blockers && (
        <div className="lookup-detail-section">
          <h3 className="lookup-detail-section-title">Blockers & Product Gaps</h3>
          <div className="lookup-detail-text-field">
            <div className="lookup-detail-text-value">
              {renderRichText(opportunity.blockers)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OppSalesforceCard;
