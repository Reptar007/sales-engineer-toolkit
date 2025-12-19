import React, { useState, useEffect } from 'react';  
import { searchOpportunities, fetchGongConversations } from '../../../services/api';
import './SalesforceLookup.css';

const SalesforceLookup = () => {  
    const [searchTerm, setSearchTerm] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [hasSearched, setHasSearched] = useState(false);
    const [selectedOpportunity, setSelectedOpportunity] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        const trimmedSearch = searchTerm.trim();
        if (!trimmedSearch || trimmedSearch.length < 2) {
            setError('Search term must be at least 2 characters long');
            return;
        }

        setLoading(true);
        setError(null);
        setHasSearched(true);
        setSelectedOpportunity(null);

        try {
            const response = await searchOpportunities(trimmedSearch);
            if (response.success) {
                setResults(response.data || []);
            } else {
                setError(response.error || 'Search failed');
                setResults([]);
            }
        } catch (err) {
            setError(err.message || 'Failed to search opportunities');
            setResults([]);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (amount) => {
        if (!amount) return 'N/A';
        return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString();
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleString();
    };

    const formatNotesWithDates = (text) => {
        if (!text) return '';
        
        // Simple approach: Replace space + date pattern with newline + date
        // This handles the common case: "text 12/15: more text" -> "text\n12/15: more text"
        // Only match dates that are preceded by a space (not already at line start)
        let formatted = text.replace(/([ \t])(\d{1,2}\/\d{1,2}:)/g, '\n$2');
        
        // Clean up any triple+ newlines
        formatted = formatted.replace(/\n{3,}/g, '\n\n');
        
        return formatted;
    };

    // Convert HTML string to React elements, preserving formatting
    const htmlToReact = (htmlString) => {
        if (!htmlString) return null;
        
        // Create a temporary DOM element to parse HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlString;
        
        // Recursively convert DOM nodes to React elements
        const convertNode = (node, key = 0, parentKey = '') => {
            const nodeKey = `${parentKey}-${key}`;
            
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent || '';
                if (!text.trim()) return null;
                
                // Format dates in text nodes (add newlines before dates)
                const formattedText = formatNotesWithDates(text);
                
                // Split by newlines and render each part
                const parts = formattedText.split('\n');
                const result = [];
                parts.forEach((part, idx) => {
                    if (idx > 0) {
                        // Add line break before each part after the first
                        result.push(<br key={`${nodeKey}-br-${idx}`} />);
                    }
                    if (part.trim()) {
                        result.push(<span key={`${nodeKey}-text-${idx}`}>{part}</span>);
                    }
                });
                
                return result.length > 0 ? result : null;
            }
            
            if (node.nodeType === Node.ELEMENT_NODE) {
                const tagName = node.tagName.toLowerCase();
                const children = Array.from(node.childNodes)
                    .map((child, idx) => convertNode(child, idx, nodeKey))
                    .flat()
                    .filter(Boolean);
                
                switch (tagName) {
                    case 'strong':
                    case 'b':
                        return <strong key={nodeKey}>{children}</strong>;
                    case 'em':
                    case 'i':
                        return <em key={nodeKey}>{children}</em>;
                    case 'ul':
                        return (
                            <ul key={nodeKey} style={{ 
                                marginTop: '0.5rem', 
                                marginBottom: '0.5rem',
                                paddingLeft: '1.5rem',
                                listStyleType: 'disc'
                            }}>
                                {children}
                            </ul>
                        );
                    case 'ol':
                        return (
                            <ol key={nodeKey} style={{ 
                                marginTop: '0.5rem', 
                                marginBottom: '0.5rem',
                                paddingLeft: '1.5rem'
                            }}>
                                {children}
                            </ol>
                        );
                    case 'li':
                        return (
                            <li key={nodeKey} style={{ 
                                marginBottom: '0.25rem',
                                lineHeight: '1.5'
                            }}>
                                {children}
                            </li>
                        );
                    case 'div': {
                        // Check if this div contains only a strong tag (likely a heading)
                        const strongChild = node.querySelector('strong');
                        if (strongChild && node.children.length === 1 && strongChild.textContent) {
                            const text = strongChild.textContent.trim();
                            // Check if it's a main heading (no colon, reasonable length)
                            if (text.length > 15 && text.length < 80 && !text.includes(':')) {
                                return (
                                    <h4 key={nodeKey} style={{ 
                                        fontWeight: 'bold', 
                                        fontSize: '1.1rem', 
                                        marginTop: '1rem',
                                        marginBottom: '0.75rem',
                                        lineHeight: '1.4'
                                    }}>
                                        {children}
                                    </h4>
                                );
                            }
                        }
                        // Check if it's a section heading (ends with colon, like "Date:", "Overview:")
                        const textContent = node.textContent?.trim() || '';
                        if (textContent && /^[A-Z][A-Za-z\s&]+:\s*$/.test(textContent)) {
                            return (
                                <p key={nodeKey} style={{ 
                                    marginTop: '0.75rem', 
                                    marginBottom: '0.25rem',
                                    fontWeight: 'bold'
                                }}>
                                    {children}
                                </p>
                            );
                        }
                        // Regular div - render with spacing, but check if it's empty
                        if (!textContent && node.children.length === 0) {
                            return null;
                        }
                        return (
                            <div key={nodeKey} style={{ 
                                marginTop: '0.5rem',
                                marginBottom: '0.5rem',
                                lineHeight: '1.5'
                            }}>
                                {children}
                            </div>
                        );
                    }
                    case 'br':
                        return <br key={nodeKey} />;
                    case 'p':
                        return (
                            <p key={nodeKey} style={{ 
                                marginTop: '0.25rem',
                                marginBottom: '0.25rem',
                                lineHeight: '1.5'
                            }}>
                                {children}
                            </p>
                        );
                    default:
                        return <span key={nodeKey}>{children}</span>;
                }
            }
            
            return null;
        };
        
        // Convert all child nodes
        const elements = Array.from(tempDiv.childNodes)
            .map((node, idx) => convertNode(node, idx, 'root'))
            .flat()
            .filter(Boolean);
        
        return elements.length > 0 ? elements : null;
    };

    // Render rich text with formatting (bold, italic, bullets, etc.)
    const renderRichText = (text) => {
        if (!text) return null;
        
        // Check if text contains HTML tags
        const hasHtml = /<[a-z][\s\S]*>/i.test(text);
        
        if (hasHtml) {
            // Render HTML directly
            return htmlToReact(text);
        }
        
        // Otherwise, use plain text formatting
        const formattedText = formatNotesWithDates(text);
        const lines = formattedText.split('\n');
        
        // Helper to parse inline formatting: **bold**, *italic*
        const parseInlineFormatting = (content) => {
            if (!content) return [];
            
            const parts = [];
            let lastIndex = 0;
            let key = 0;
            
            // Find all **bold** matches first (higher priority)
            const boldMatches = [];
            let boldMatch;
            const boldRegex = /\*\*([^*]+)\*\*/g;
            while ((boldMatch = boldRegex.exec(content)) !== null) {
                boldMatches.push({
                    index: boldMatch.index,
                    endIndex: boldMatch.index + boldMatch[0].length,
                    content: boldMatch[1],
                    type: 'strong'
                });
            }
            
            // Find all *italic* matches (but not inside **bold**)
            const italicMatches = [];
            let italicMatch;
            const italicRegex = /(?<!\*)\*([^*]+)\*(?!\*)/g;
            while ((italicMatch = italicRegex.exec(content)) !== null) {
                // Check if this is inside a bold match
                const insideBold = boldMatches.some(bm => 
                    italicMatch.index >= bm.index && italicMatch.index < bm.endIndex
                );
                if (!insideBold) {
                    italicMatches.push({
                        index: italicMatch.index,
                        endIndex: italicMatch.index + italicMatch[0].length,
                        content: italicMatch[1],
                        type: 'em'
                    });
                }
            }
            
            // Combine and sort all matches
            const allMatches = [...boldMatches, ...italicMatches].sort((a, b) => a.index - b.index);
            
            // Build parts array
            allMatches.forEach((match) => {
                if (match.index > lastIndex) {
                    parts.push({ type: 'text', content: content.substring(lastIndex, match.index), key: key++ });
                }
                parts.push({ type: match.type, content: match.content, key: key++ });
                lastIndex = match.endIndex;
            });
            
            if (lastIndex < content.length) {
                parts.push({ type: 'text', content: content.substring(lastIndex), key: key++ });
            }
            
            return parts.length > 0 ? parts : [{ type: 'text', content, key: 0 }];
        };
        
        return lines.map((line, lineIdx) => {
            const trimmedLine = line.trim();
            
            if (!trimmedLine) {
                return <p key={lineIdx} style={{ marginBottom: '0.5rem' }}>&nbsp;</p>;
            }
            
            // Check for bullet points (lines starting with -, *, or •)
            const bulletMatch = trimmedLine.match(/^[-*•]\s+(.*)$/);
            const content = bulletMatch ? bulletMatch[1] : trimmedLine;
            const isBullet = !!bulletMatch;
            
            // Check for main headings (lines that look like titles - title case, no colon, reasonable length)
            const isMainHeading = trimmedLine.length > 15 && 
                                 trimmedLine.length < 80 &&
                                 /^[A-Z][A-Za-z\s&–-]+$/.test(trimmedLine) && 
                                 !trimmedLine.includes(':');
            
            // Check for section headings (single word/phrase ending with colon, like "Date:", "Overview:")
            const sectionHeadingMatch = trimmedLine.match(/^([A-Z][A-Za-z\s&]+):\s*$/);
            const isSectionHeading = !!sectionHeadingMatch;
            
            // Check for bold labels within content (text ending with colon followed by content, like "Technical Complexity: description")
            const boldLabelMatch = trimmedLine.match(/^([A-Z][A-Za-z\s&()]+):\s+(.+)$/);
            
            // Render the line
            if (isMainHeading) {
                return (
                    <h4 key={lineIdx} style={{ 
                        fontWeight: 'bold', 
                        fontSize: '1.1rem', 
                        marginTop: lineIdx > 0 ? '1rem' : '0',
                        marginBottom: '0.75rem',
                        lineHeight: '1.4'
                    }}>
                        {trimmedLine}
                    </h4>
                );
            }
            
            if (isSectionHeading) {
                return (
                    <p key={lineIdx} style={{ 
                        marginTop: lineIdx > 0 ? '0.75rem' : '0', 
                        marginBottom: '0.25rem',
                        fontWeight: 'bold'
                    }}>
                        {trimmedLine}
                    </p>
                );
            }
            
            if (boldLabelMatch) {
                const label = boldLabelMatch[1];
                const rest = boldLabelMatch[2];
                const labelParts = parseInlineFormatting(label);
                const restParts = parseInlineFormatting(rest);
                
                return (
                    <p key={lineIdx} style={{ 
                        marginTop: lineIdx > 0 ? '0.5rem' : '0', 
                        marginBottom: '0.25rem',
                        paddingLeft: isBullet ? '1.5rem' : '0',
                        lineHeight: '1.5'
                    }}>
                        {isBullet && <span style={{ marginRight: '0.5rem' }}>•</span>}
                        <strong>
                            {labelParts.map(part => 
                                part.type === 'text' ? part.content :
                                part.type === 'strong' ? <strong key={part.key}>{part.content}</strong> :
                                <em key={part.key}>{part.content}</em>
                            )}
                        </strong>
                        {': '}
                        {restParts.map(part => 
                            part.type === 'text' ? part.content :
                            part.type === 'strong' ? <strong key={part.key}>{part.content}</strong> :
                            <em key={part.key}>{part.content}</em>
                        )}
                    </p>
                );
            }
            
            // Regular line with potential formatting
            const parts = parseInlineFormatting(content);
            
            return (
                <p key={lineIdx} style={{ 
                    marginTop: lineIdx > 0 ? '0.25rem' : '0', 
                    marginBottom: '0.25rem',
                    paddingLeft: isBullet ? '1.5rem' : '0',
                    lineHeight: '1.5'
                }}>
                    {isBullet && <span style={{ marginRight: '0.5rem' }}>•</span>}
                    {parts.map(part => 
                        part.type === 'text' ? part.content :
                        part.type === 'strong' ? <strong key={part.key}>{part.content}</strong> :
                        <em key={part.key}>{part.content}</em>
                    )}
                </p>
            );
        });
    };

    const renderStagePath = (opportunity) => {
        if (!opportunity) return null;

        // Define standard Salesforce opportunity stages
        const stages = [
            { id: 1, name: '1. Discovery', key: 'Discovery' },
            { id: 2, name: '2. Evaluation', key: 'Evaluation' },
            { id: 3, name: '3. Proposal', key: 'Proposal' },
            { id: 4, name: '4. Contracting', key: 'Contracting' },
            { id: 5, name: 'Closed', key: 'Closed' },
        ];

        // Determine current stage index
        const currentStage = opportunity.stage || '';
        let currentStageIndex = -1;
        
        stages.forEach((stage, index) => {
            if (currentStage.toLowerCase().includes(stage.key.toLowerCase())) {
                currentStageIndex = index;
            }
        });

        // If stage is closed/won, mark all as completed
        if (opportunity.isClosed || opportunity.isWon) {
            currentStageIndex = stages.length - 1;
        }

        return (
            <div className="lookup-stage-path-container">
                <div className="lookup-stage-path-scroll">
                    <div className="lookup-stage-path">
                        {stages.map((stage, index) => {
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

    const GongConversationsSection = ({ opportunityId }) => {
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
                    if (response.success) {
                        setConversations(response.data || []);
                    }
                } catch (err) {
                    setError(err.message);
                    // Silently fail - Gong might not be available
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
                    <p style={{ color: '#666', fontSize: '0.9375rem' }}>Loading conversations...</p>
                </div>
            );
        }

        if (error || conversations.length === 0) {
            return null; // Don't show section if no conversations
        }

        const formatDuration = (duration) => {
            if (!duration) return 'N/A';
            
            // If it's already in MM:SS format (string), return as-is
            if (typeof duration === 'string' && duration.includes(':')) {
                return duration;
            }
            
            // If it's a number (minutes), convert to MM:SS
            if (typeof duration === 'number') {
                const mins = Math.floor(duration);
                const secs = Math.round((duration - mins) * 60);
                return `${mins}:${secs.toString().padStart(2, '0')}`;
            }
            
            return 'N/A';
        };

        return (
            <div className="lookup-detail-section">
                <div className="lookup-gong-header">
                    <h3 className="lookup-detail-section-title">Gong Conversations ({conversations.length}+)</h3>
                </div>
                <div className={`lookup-gong-conversations ${conversations.length > 4 ? 'lookup-gong-conversations-scrollable' : ''}`}>
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
                                            <span className="lookup-gong-detail-value">{formatDuration(conversation.duration)}</span>
                                        </div>
                                    )}
                                    {conversation.createdDate && (
                                        <div className="lookup-gong-detail-item">
                                            <span className="lookup-gong-detail-label">Created Date:</span>
                                            <span className="lookup-gong-detail-value">{formatDateTime(conversation.createdDate)}</span>
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

    const renderFullDetails = (opportunity) => {
        if (!opportunity) return null;

        return (
            <div className="lookup-full-details">
                {renderStagePath(opportunity)}
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
                            <span className="lookup-detail-label">Gross ARR</span>
                            <span className="lookup-detail-value">{formatCurrency(opportunity.grossARR)}</span>
                        </div>
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
                    <div className="lookup-gong-column">
                        <GongConversationsSection opportunityId={opportunity.id} />
                    </div>
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
                            <span className="lookup-detail-value lookup-detail-value-small">{opportunity.currentQASetup || 'N/A'}</span>
                        </div>
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
                                <div className="lookup-detail-text-value">
                                    {renderRichText(opportunity.nextStep)}
                                </div>
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

    // Show loading screen
    if (loading) {
        return (
            <div className="salesforce-lookup">
                <div className="lookup-loading-screen">
                    <div className="lookup-spinner"></div>
                    <h2>Searching Salesforce...</h2>
                    <p>Please wait while we find matching opportunities</p>
                </div>
            </div>
        );
    }

    return (
        <div className={`salesforce-lookup ${hasSearched ? 'salesforce-lookup-has-results' : ''}`}>
            <div className={`lookup-header ${hasSearched ? 'lookup-header-compact' : ''}`}>
                <div className="lookup-header-content">
                    <h1>Salesforce Lookup</h1>
                    {!hasSearched && <p>Search for opportunities by name or account</p>}
                </div>
                <form onSubmit={handleSubmit} className={`lookup-search-form ${hasSearched ? 'lookup-search-form-compact' : ''}`}>
                    <div className="lookup-search-container">
                        <input
                            type="text"
                            className="lookup-search-input"
                            placeholder="Enter opportunity name or account name..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            disabled={loading}
                            aria-label="Search opportunities"
                        />
                        <button 
                            type="submit" 
                            className="lookup-search-button"
                            disabled={loading || !searchTerm.trim()}
                        >
                            Search
                        </button>
                    </div>
                </form>
            </div>

            {error && (
                <div className="lookup-error">
                    <p>{error}</p>
                </div>
            )}

            {hasSearched && !loading && !error && (
                <div className="lookup-results">
                    {results.length === 0 ? (
                        <>
                            <h2>Results (0)</h2>
                            <div className="lookup-empty">
                                <p>No opportunities found matching your search.</p>
                            </div>
                        </>
                    ) : results.length === 1 ? (
                        <>
                            <h2 className="lookup-opportunity-name">{results[0].name || 'Opportunity'}</h2>
                            <div className="lookup-single-result">
                                <div className="lookup-detail-card">
                                    {renderFullDetails(results[0])}
                                </div>
                            </div>
                        </>
                    ) : selectedOpportunity ? (
                        <>
                            <div className="lookup-results-header">
                                <h2 className="lookup-opportunity-name">{selectedOpportunity.name || 'Selected Opportunity'}</h2>
                                <button 
                                    className="lookup-back-button"
                                    onClick={() => setSelectedOpportunity(null)}
                                >
                                    ← Back to Results
                                </button>
                            </div>
                            <div className="lookup-single-result">
                                <div className="lookup-detail-card">
                                    {renderFullDetails(selectedOpportunity)}
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <h2>Results ({results.length})</h2>
                            <p className="lookup-select-hint">Click on a card to view full details</p>
                            <div className="lookup-cards-container">
                                {results.map((opportunity) => (
                                    <div 
                                        key={opportunity.id}
                                        className="lookup-card"
                                        onClick={() => setSelectedOpportunity(opportunity)}
                                    >
                                        <div className="lookup-card-header">
                                            <h3>{opportunity.name || 'N/A'}</h3>
                                        </div>
                                        <div className="lookup-card-body">
                                            <div className="lookup-card-field">
                                                <span className="lookup-card-label">Account:</span>
                                                <span className="lookup-card-value">{opportunity.accountName || 'N/A'}</span>
                                            </div>
                                            <div className="lookup-card-field">
                                                <span className="lookup-card-label">Stage:</span>
                                                <span className="lookup-card-value">{opportunity.stage || 'N/A'}</span>
                                            </div>
                                            <div className="lookup-card-field">
                                                <span className="lookup-card-label">Amount:</span>
                                                <span className="lookup-card-value">
                                                    {formatCurrency(opportunity.amount || opportunity.arr)}
                                                </span>
                                            </div>
                                            <div className="lookup-card-field">
                                                <span className="lookup-card-label">Close Date:</span>
                                                <span className="lookup-card-value">{formatDate(opportunity.closeDate)}</span>
                                            </div>
                                            <div className="lookup-card-field">
                                                <span className="lookup-card-label">Probability:</span>
                                                <span className="lookup-card-value">
                                                    {opportunity.probability !== null ? `${opportunity.probability}%` : 'N/A'}
                                                </span>
                                            </div>
                                            <div className="lookup-card-field">
                                                <span className="lookup-card-label">Owner:</span>
                                                <span className="lookup-card-value">{opportunity.ownerName || 'N/A'}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default SalesforceLookup;