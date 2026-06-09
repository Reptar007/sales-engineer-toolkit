// Shared rich-text renderer for Salesforce description / notes fields. Lives
// alongside the formatters so the components file only exports components
// (keeps React Fast Refresh happy).

import React from 'react';
import { formatNotesWithDates } from './opportunityHelpers';

// Convert an HTML fragment from Salesforce rich-text fields into a tree of
// React nodes. We do this manually (rather than dangerouslySetInnerHTML)
// because SF's HTML output mixes loose <div>s with semantic markers we
// want to upgrade -- e.g. a <div><strong>Title</strong></div> is rendered
// as an <h4>, "Section:" labels become bold paragraphs, etc. Keeps the
// notes block readable without a separate WYSIWYG library.
function htmlToReact(htmlString) {
  if (!htmlString) return null;
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlString;

  const convertNode = (node, key = 0, parentKey = '') => {
    const nodeKey = `${parentKey}-${key}`;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (!text.trim()) return null;
      const formattedText = formatNotesWithDates(text);
      const parts = formattedText.split('\n');
      const result = [];
      parts.forEach((part, idx) => {
        if (idx > 0) result.push(<br key={`${nodeKey}-br-${idx}`} />);
        if (part.trim()) result.push(<span key={`${nodeKey}-text-${idx}`}>{part}</span>);
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
            <ul
              key={nodeKey}
              style={{
                marginTop: '0.5rem',
                marginBottom: '0.5rem',
                paddingLeft: '1.5rem',
                listStyleType: 'disc',
              }}
            >
              {children}
            </ul>
          );
        case 'ol':
          return (
            <ol
              key={nodeKey}
              style={{ marginTop: '0.5rem', marginBottom: '0.5rem', paddingLeft: '1.5rem' }}
            >
              {children}
            </ol>
          );
        case 'li':
          return (
            <li key={nodeKey} style={{ marginBottom: '0.25rem', lineHeight: '1.5' }}>
              {children}
            </li>
          );
        case 'div': {
          const strongChild = node.querySelector('strong');
          if (strongChild && node.children.length === 1 && strongChild.textContent) {
            const text = strongChild.textContent.trim();
            if (text.length > 15 && text.length < 80 && !text.includes(':')) {
              return (
                <h4
                  key={nodeKey}
                  style={{
                    fontWeight: 'bold',
                    fontSize: '1.1rem',
                    marginTop: '1rem',
                    marginBottom: '0.75rem',
                    lineHeight: '1.4',
                  }}
                >
                  {children}
                </h4>
              );
            }
          }
          const textContent = node.textContent?.trim() || '';
          if (textContent && /^[A-Z][A-Za-z\s&]+:\s*$/.test(textContent)) {
            return (
              <p
                key={nodeKey}
                style={{ marginTop: '0.75rem', marginBottom: '0.25rem', fontWeight: 'bold' }}
              >
                {children}
              </p>
            );
          }
          if (!textContent && node.children.length === 0) return null;
          return (
            <div
              key={nodeKey}
              style={{ marginTop: '0.5rem', marginBottom: '0.5rem', lineHeight: '1.5' }}
            >
              {children}
            </div>
          );
        }
        case 'br':
          return <br key={nodeKey} />;
        case 'p':
          return (
            <p
              key={nodeKey}
              style={{ marginTop: '0.25rem', marginBottom: '0.25rem', lineHeight: '1.5' }}
            >
              {children}
            </p>
          );
        default:
          return <span key={nodeKey}>{children}</span>;
      }
    }
    return null;
  };

  const elements = Array.from(tempDiv.childNodes)
    .map((node, idx) => convertNode(node, idx, 'root'))
    .flat()
    .filter(Boolean);
  return elements.length > 0 ? elements : null;
}

export function renderRichText(text) {
  if (!text) return null;
  const hasHtml = /<[a-z][\s\S]*>/i.test(text);
  if (hasHtml) return htmlToReact(text);

  const formattedText = formatNotesWithDates(text);
  const lines = formattedText.split('\n');

  const parseInlineFormatting = (content) => {
    if (!content) return [];
    const parts = [];
    let lastIndex = 0;
    let key = 0;
    const boldMatches = [];
    let boldMatch;
    const boldRegex = /\*\*([^*]+)\*\*/g;
    while ((boldMatch = boldRegex.exec(content)) !== null) {
      boldMatches.push({
        index: boldMatch.index,
        endIndex: boldMatch.index + boldMatch[0].length,
        content: boldMatch[1],
        type: 'strong',
      });
    }
    const italicMatches = [];
    let italicMatch;
    const italicRegex = /(?<!\*)\*([^*]+)\*(?!\*)/g;
    while ((italicMatch = italicRegex.exec(content)) !== null) {
      const insideBold = boldMatches.some(
        (bm) => italicMatch.index >= bm.index && italicMatch.index < bm.endIndex,
      );
      if (!insideBold) {
        italicMatches.push({
          index: italicMatch.index,
          endIndex: italicMatch.index + italicMatch[0].length,
          content: italicMatch[1],
          type: 'em',
        });
      }
    }
    const allMatches = [...boldMatches, ...italicMatches].sort((a, b) => a.index - b.index);
    allMatches.forEach((match) => {
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          content: content.substring(lastIndex, match.index),
          key: key++,
        });
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
      return (
        <p key={lineIdx} style={{ marginBottom: '0.5rem' }}>
          &nbsp;
        </p>
      );
    }
    const bulletMatch = trimmedLine.match(/^[-*•]\s+(.*)$/);
    const content = bulletMatch ? bulletMatch[1] : trimmedLine;
    const isBullet = !!bulletMatch;
    const isMainHeading =
      trimmedLine.length > 15 &&
      trimmedLine.length < 80 &&
      /^[A-Z][A-Za-z\s&–-]+$/.test(trimmedLine) &&
      !trimmedLine.includes(':');
    const sectionHeadingMatch = trimmedLine.match(/^([A-Z][A-Za-z\s&]+):\s*$/);
    const isSectionHeading = !!sectionHeadingMatch;
    const boldLabelMatch = trimmedLine.match(/^([A-Z][A-Za-z\s&()]+):\s+(.+)$/);

    if (isMainHeading) {
      return (
        <h4
          key={lineIdx}
          style={{
            fontWeight: 'bold',
            fontSize: '1.1rem',
            marginTop: lineIdx > 0 ? '1rem' : '0',
            marginBottom: '0.75rem',
            lineHeight: '1.4',
          }}
        >
          {trimmedLine}
        </h4>
      );
    }
    if (isSectionHeading) {
      return (
        <p
          key={lineIdx}
          style={{
            marginTop: lineIdx > 0 ? '0.75rem' : '0',
            marginBottom: '0.25rem',
            fontWeight: 'bold',
          }}
        >
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
        <p
          key={lineIdx}
          style={{
            marginTop: lineIdx > 0 ? '0.5rem' : '0',
            marginBottom: '0.25rem',
            paddingLeft: isBullet ? '1.5rem' : '0',
            lineHeight: '1.5',
          }}
        >
          {isBullet && <span style={{ marginRight: '0.5rem' }}>•</span>}
          <strong>
            {labelParts.map((part) =>
              part.type === 'text' ? (
                part.content
              ) : part.type === 'strong' ? (
                <strong key={part.key}>{part.content}</strong>
              ) : (
                <em key={part.key}>{part.content}</em>
              ),
            )}
          </strong>
          {': '}
          {restParts.map((part) =>
            part.type === 'text' ? (
              part.content
            ) : part.type === 'strong' ? (
              <strong key={part.key}>{part.content}</strong>
            ) : (
              <em key={part.key}>{part.content}</em>
            ),
          )}
        </p>
      );
    }
    const parts = parseInlineFormatting(content);
    return (
      <p
        key={lineIdx}
        style={{
          marginTop: lineIdx > 0 ? '0.25rem' : '0',
          marginBottom: '0.25rem',
          paddingLeft: isBullet ? '1.5rem' : '0',
          lineHeight: '1.5',
        }}
      >
        {isBullet && <span style={{ marginRight: '0.5rem' }}>•</span>}
        {parts.map((part) =>
          part.type === 'text' ? (
            part.content
          ) : part.type === 'strong' ? (
            <strong key={part.key}>{part.content}</strong>
          ) : (
            <em key={part.key}>{part.content}</em>
          ),
        )}
      </p>
    );
  });
}
