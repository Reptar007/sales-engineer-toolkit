import React, { useState, useEffect } from 'react';
import { fetchGongConversations } from '../../../services/api';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatGongDuration,
  lookupPrimaryRevenue,
  lookupShowGrossARRRow,
  STAGES,
} from './opportunityHelpers';
import { renderRichText } from './richText.jsx';

// Render-helpers + card components shared between the standalone Salesforce
// Lookup page and the Opp Detail handoff page. Pure formatters and the
// rich-text renderer live in sibling files so this module only exports
// React components (required for fast-refresh to work without invalidating
// the helpers on every edit).

export const StagePath = ({ opportunity }) => {
  if (!opportunity) return null;
  const currentStage = opportunity.stage || '';
  let currentStageIndex = -1;
  STAGES.forEach((stage, index) => {
    if (currentStage.toLowerCase().includes(stage.key.toLowerCase())) {
      currentStageIndex = index;
    }
  });
  if (opportunity.isClosed || opportunity.isWon) {
    currentStageIndex = STAGES.length - 1;
  }
  return (
    <div className="lookup-stage-path-container">
      <div className="lookup-stage-path-scroll">
        <div className="lookup-stage-path">
          {STAGES.map((stage, index) => {
            const isCompleted = index < currentStageIndex;
            const isCurrent = index === currentStageIndex;
            return (
              <div
                key={stage.id}
                className={`lookup-stage-segment ${
                  isCompleted
                    ? 'lookup-stage-completed'
                    : isCurrent
                      ? 'lookup-stage-current'
                      : 'lookup-stage-pending'
                }`}
              >
                {isCompleted && (
                  <div className="lookup-stage-checkmark">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M13.3333 4L6 11.3333L2.66667 8"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                )}
                <span className="lookup-stage-label">{stage.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const GongConversationsSection = ({ opportunityId }) => {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!opportunityId) return;
    const loadConversations = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchGongConversations(opportunityId);
        if (response.success) setConversations(response.data || []);
      } catch (err) {
        setError(err.message);
        setConversations([]);
      } finally {
        setLoading(false);
      }
    };
    loadConversations();
  }, [opportunityId]);

  if (loading) {
    return (
      <div className="lookup-detail-section">
        <h3 className="lookup-detail-section-title">Gong Conversations</h3>
        <p className="lookup-gong-loading">Loading conversations…</p>
      </div>
    );
  }

  if (error || conversations.length === 0) return null;

  return (
    <div className="lookup-detail-section">
      <div className="lookup-gong-header">
        <h3 className="lookup-detail-section-title">
          Gong Conversations ({conversations.length}+)
        </h3>
      </div>
      <div
        className={`lookup-gong-conversations ${
          conversations.length > 4 ? 'lookup-gong-conversations-scrollable' : ''
        }`}
      >
        {conversations.map((conversation) => (
          <div key={conversation.id} className="lookup-gong-conversation-item">
            <div className="lookup-gong-conversation-content">
              {conversation.url ? (
                <a
                  href={conversation.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lookup-gong-conversation-title-link"
                >
                  {conversation.title || conversation.name || 'Untitled Conversation'}
                </a>
              ) : (
                <div className="lookup-gong-conversation-title">
                  {conversation.title || conversation.name || 'Untitled Conversation'}
                </div>
              )}
              <div className="lookup-gong-conversation-details-two-col">
                {conversation.duration && (
                  <div className="lookup-gong-detail-item">
                    <span className="lookup-gong-detail-label">Duration (Min.):</span>
                    <span className="lookup-gong-detail-value">
                      {formatGongDuration(conversation.duration)}
                    </span>
                  </div>
                )}
                {conversation.createdDate && (
                  <div className="lookup-gong-detail-item">
                    <span className="lookup-gong-detail-label">Created Date:</span>
                    <span className="lookup-gong-detail-value">
                      {formatDateTime(conversation.createdDate)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Read-only Salesforce opportunity overview. Used by both the Salesforce
 * Lookup page (after a search match) and the Opp Detail handoff page.
 *
 * Props:
 *   opportunity: SalesforceOpportunity (the flat shape returned by
 *     `searchOpportunities` -- name, accountName, stage, products, blockers,
 *     description, AE notes, etc.)
 *   showGong: whether to render the Gong conversations column. Defaults to
 *     true; the Opp page can disable it when Gong is rendered elsewhere.
 */
export const OpportunityDetailsCard = ({ opportunity, showGong = true }) => {
  if (!opportunity) return null;
  return (
    <div className="lookup-full-details">
      <StagePath opportunity={opportunity} />
      <div className="lookup-basic-gong-split">
        <div className="lookup-basic-info-column">
          <div className="lookup-detail-section">
            <h3 className="lookup-detail-section-title">Basic Information</h3>
            <div className="lookup-detail-grid">
              <div className="lookup-detail-item">
                <span className="lookup-detail-label">Opportunity Name</span>
                <span className="lookup-detail-value">{opportunity.name || 'N/A'}</span>
              </div>
              <div className="lookup-detail-item">
                <span className="lookup-detail-label">Account</span>
                <span className="lookup-detail-value">{opportunity.accountName || 'N/A'}</span>
              </div>
              <div className="lookup-detail-item">
                <span className="lookup-detail-label">Stage</span>
                <span className="lookup-detail-value">{opportunity.stage || 'N/A'}</span>
              </div>
              <div className="lookup-detail-item">
                <span className="lookup-detail-label">Type</span>
                <span className="lookup-detail-value">{opportunity.type || 'N/A'}</span>
              </div>
              <div className="lookup-detail-item">
                <span className="lookup-detail-label">CARR</span>
                <span className="lookup-detail-value">
                  {formatCurrency(lookupPrimaryRevenue(opportunity))}
                </span>
              </div>
              {lookupShowGrossARRRow(opportunity) && (
                <div className="lookup-detail-item">
                  <span className="lookup-detail-label">Gross ARR</span>
                  <span className="lookup-detail-value">
                    {formatCurrency(opportunity.grossARR)}
                  </span>
                </div>
              )}
              <div className="lookup-detail-item">
                <span className="lookup-detail-label">Close Date</span>
                <span className="lookup-detail-value">{formatDate(opportunity.closeDate)}</span>
              </div>
              <div className="lookup-detail-item">
                <span className="lookup-detail-label">Probability</span>
                <span className="lookup-detail-value">
                  {opportunity.probability !== null ? `${opportunity.probability}%` : 'N/A'}
                </span>
              </div>
              <div className="lookup-detail-item">
                <span className="lookup-detail-label">Forecast Category</span>
                <span className="lookup-detail-value">{opportunity.forecastCategory || 'N/A'}</span>
              </div>
              <div className="lookup-detail-item">
                <span className="lookup-detail-label">Is Closed</span>
                <span className="lookup-detail-value">{opportunity.isClosed ? 'Yes' : 'No'}</span>
              </div>
              <div className="lookup-detail-item">
                <span className="lookup-detail-label">Is Won</span>
                <span className="lookup-detail-value">{opportunity.isWon ? 'Yes' : 'No'}</span>
              </div>
              {opportunity.champion && (
                <div className="lookup-detail-item">
                  <span className="lookup-detail-label">Champion</span>
                  <span className="lookup-detail-value">{opportunity.champion}</span>
                </div>
              )}
              {opportunity.championContactName && (
                <div className="lookup-detail-item">
                  <span className="lookup-detail-label">Champion Contact</span>
                  <span className="lookup-detail-value">{opportunity.championContactName}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        {showGong && (
          <div className="lookup-gong-column">
            <GongConversationsSection opportunityId={opportunity.id} />
          </div>
        )}
      </div>

      <div className="lookup-detail-section">
        <h3 className="lookup-detail-section-title">Account & Ownership</h3>
        <div className="lookup-detail-grid">
          <div className="lookup-detail-item">
            <span className="lookup-detail-label">Account Name</span>
            <span className="lookup-detail-value">{opportunity.accountName || 'N/A'}</span>
          </div>
          <div className="lookup-detail-item">
            <span className="lookup-detail-label">Account Score</span>
            <span className="lookup-detail-value">{opportunity.accountScore || 'N/A'}</span>
          </div>
          <div className="lookup-detail-item">
            <span className="lookup-detail-label">Owner</span>
            <span className="lookup-detail-value">{opportunity.ownerName || 'N/A'}</span>
          </div>
          <div className="lookup-detail-item">
            <span className="lookup-detail-label">Product</span>
            <span className="lookup-detail-value">{opportunity.product || 'N/A'}</span>
          </div>
        </div>
      </div>

      <div className="lookup-detail-section">
        <h3 className="lookup-detail-section-title">Company Information</h3>
        <div className="lookup-detail-grid">
          <div className="lookup-detail-item">
            <span className="lookup-detail-label">Company Size</span>
            <span className="lookup-detail-value">
              {opportunity.companySize ? opportunity.companySize.toLocaleString() : 'N/A'}
            </span>
          </div>
          <div className="lookup-detail-item">
            <span className="lookup-detail-label">Headcount Range</span>
            <span className="lookup-detail-value">{opportunity.headcountRange || 'N/A'}</span>
          </div>
          <div className="lookup-detail-item">
            <span className="lookup-detail-label">Competitor</span>
            <span className="lookup-detail-value">{opportunity.competitor || 'N/A'}</span>
          </div>
          <div className="lookup-detail-item">
            <span className="lookup-detail-label">Current QA Setup</span>
            <span className="lookup-detail-value lookup-detail-value-small">
              {opportunity.currentQASetup || 'N/A'}
            </span>
          </div>
        </div>
      </div>

      {opportunity.blockers && (
        <div className="lookup-detail-section">
          <h3 className="lookup-detail-section-title">Blockers & Product Gaps</h3>
          <div className="lookup-detail-text-field">
            <div className="lookup-detail-text-value">{renderRichText(opportunity.blockers)}</div>
          </div>
        </div>
      )}

      {(opportunity.description || opportunity.nextStep) && (
        <div className="lookup-detail-section">
          <h3 className="lookup-detail-section-title">Details</h3>
          {opportunity.description && (
            <div className="lookup-detail-text-field">
              <span className="lookup-detail-label">Description</span>
              <div className="lookup-detail-text-value">
                {renderRichText(opportunity.description)}
              </div>
            </div>
          )}
          {opportunity.nextStep && (
            <div className="lookup-detail-text-field">
              <span className="lookup-detail-label">Next Step</span>
              <div className="lookup-detail-text-value">{renderRichText(opportunity.nextStep)}</div>
            </div>
          )}
        </div>
      )}

      {(opportunity.aeDetailedNotes || opportunity.meetingBookedDetails) && (
        <div className="lookup-detail-section">
          <h3 className="lookup-detail-section-title">AE Notes</h3>
          {opportunity.aeDetailedNotes && (
            <div className="lookup-detail-text-field">
              <span className="lookup-detail-label">AE Detailed Notes</span>
              <div className="lookup-detail-text-value">
                {renderRichText(opportunity.aeDetailedNotes)}
              </div>
            </div>
          )}
          {opportunity.meetingBookedDetails && (
            <div className="lookup-detail-text-field">
              <span className="lookup-detail-label">Meeting Booked Details</span>
              <div className="lookup-detail-text-value">
                {renderRichText(opportunity.meetingBookedDetails)}
              </div>
            </div>
          )}
        </div>
      )}

      {(opportunity.managerNotes || opportunity.managerNotesForecast) && (
        <div className="lookup-detail-section">
          <h3 className="lookup-detail-section-title">Manager Notes</h3>
          {opportunity.managerNotes && (
            <div className="lookup-detail-text-field">
              <span className="lookup-detail-label">Manager Notes</span>
              <div className="lookup-detail-text-value">
                {renderRichText(opportunity.managerNotes)}
              </div>
            </div>
          )}
          {opportunity.managerNotesForecast && (
            <div className="lookup-detail-text-field">
              <span className="lookup-detail-label">Manager Notes Forecast</span>
              <div className="lookup-detail-text-value">
                {renderRichText(opportunity.managerNotesForecast)}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="lookup-detail-section">
        <h3 className="lookup-detail-section-title">System Information</h3>
        <div className="lookup-detail-grid">
          <div className="lookup-detail-item">
            <span className="lookup-detail-label">Opportunity ID</span>
            <span className="lookup-detail-value">{opportunity.id || 'N/A'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OpportunityDetailsCard;
