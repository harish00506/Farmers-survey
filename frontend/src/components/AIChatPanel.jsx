import React, { useState } from 'react';
import axios from 'axios';
import Skeleton, { Line } from './ui/Skeleton';
import SectionTitle from './ui/SectionTitle';

const renderInlineMarkup = (text, keyPrefix) => {
  if (!text) return text;
  const regex = /\*\*(.*?)\*\*/g;
  const nodes = [];
  let lastIndex = 0;
  let match;
  let idx = 0;

  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) {
      nodes.push(before);
    }
    nodes.push(<strong key={`${keyPrefix}-strong-${idx++}`}>{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
  }

  const rest = text.slice(lastIndex);
  if (rest) {
    nodes.push(rest);
  }

  if (nodes.length === 0) return '';
  return nodes.length === 1 ? nodes[0] : <>{nodes}</>;
};

const parseHtmlMessage = (html) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const convert = (node, index) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    const tag = node.tagName.toLowerCase();
    const children = Array.from(node.childNodes)
      .map((child, childIndex) => convert(child, `${index}-${childIndex}`))
      .filter((child) => child !== null);
    const styles = { margin: 0 };
    if (tag === 'ul') {
      styles.paddingLeft = '1.25rem';
      styles.margin = '0 0 0.5rem';
    }
    return React.createElement(tag, { key: `${tag}-${index}`, style: styles },
      children.length ? children : node.textContent
    );
  };

  return Array.from(doc.body.childNodes)
    .map((child, idx) => convert(child, idx))
    .filter((node) => node !== null);
};

const renderMessageContent = (text) => {
  const trimmed = text.trim();

  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    const parsed = parseHtmlMessage(trimmed);
    if (parsed.length > 0) {
      return parsed;
    }
  }

  const lines = text.split('\n');
  const nodes = [];
  let tableLines = [];
  let listItems = [];
  let paragraphLines = [];
  let blockKey = 0;

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const paragraphText = paragraphLines.join(' ').trim();
    nodes.push(
      <p key={`para-${blockKey++}`} style={{ margin: '0 0 0.5rem' }}>
        {renderInlineMarkup(paragraphText, `para-${blockKey}`)}
      </p>
    );
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    nodes.push(
      <ul key={`list-${blockKey++}`} style={{ paddingLeft: '1.25rem', margin: '0 0 0.5rem' }}>
        {listItems.map((item, idx) => (
          <li key={`${item}-${idx}`} style={{ lineHeight: '1.6' }}>
            {renderInlineMarkup(item, `list-${idx}`)}
          </li>
        ))}
      </ul>
    );
    listItems = [];
  };

  const flushTable = () => {
    if (!tableLines.length) return;
    const normalizedRows = tableLines
      .map((row) =>
        row
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim())
      )
      .filter((cells) => cells.some((cell) => cell.length > 0));

    if (!normalizedRows.length) {
      tableLines = [];
      return;
    }

    const header = normalizedRows[0];
    const body = normalizedRows.slice(1).filter(
      (row) => !row.every((cell) => /^[-\s]+$/.test(cell))
    );

    nodes.push(
      <table
        key={`table-${blockKey++}`}
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          marginBottom: '0.75rem',
          fontSize: '0.9rem',
        }}
      >
        <thead>
          <tr>
            {header.map((cell, idx) => (
              <th
                key={`th-${idx}`}
                style={{
                  textAlign: 'left',
                  borderBottom: '1px solid #bdc3c7',
                  padding: '0.35rem 0.25rem',
                  fontWeight: 600,
                }}
              >
                {renderInlineMarkup(cell, `cell-${idx}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {row.map((cell, idx) => (
                <td
                  key={`td-${rowIndex}-${idx}`}
                  style={{
                    padding: '0.35rem 0.25rem',
                    borderBottom: '1px solid #ecf0f1',
                  }}
                >
                  {renderInlineMarkup(cell, `td-${rowIndex}-${idx}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );

    tableLines = [];
  };

  lines.forEach((line) => {
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('|') && trimmedLine.endsWith('|')) {
      flushParagraph();
      flushList();
      tableLines.push(trimmedLine);
      return;
    }

    flushTable();

    if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
      flushParagraph();
      listItems.push(trimmedLine.slice(2));
      return;
    }

    flushList();

    if (trimmedLine === '') {
      flushParagraph();
      return;
    }

    paragraphLines.push(trimmedLine);
  });

  flushTable();
  flushList();
  flushParagraph();

  return nodes;
};

export default function AIChatPanel() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;

    const userMessage = {
      id: Date.now(),
      type: 'user',
      text: inputValue,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setLoading(true);

    try {
      const response = await axios.post('http://localhost:3000/api/ai/chat', { question: inputValue });
      const botText = response.data?.message || 'No response from AI.';
      const dataPoints = response.data?.dataPoints;

      const botMessage = {
        id: Date.now() + 1,
        type: 'bot',
        text: dataPoints ? `${botText}\n\n(Analysis based on ${dataPoints} data points)` : botText,
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (err) {
      console.error('AI chat failed', err);
      const botMessage = {
        id: Date.now() + 1,
        type: 'bot',
        text: '❌ AI analysis unavailable. This feature is in development; showing placeholder result.',
      };
      setMessages((prev) => [...prev, botMessage]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="card chat-wrapper">
        <SectionTitle icon="chat" title="Chat with Survey Data" />
        <p style={{ color: '#7f8c8d', marginBottom: '1rem' }}>
          Ask questions about farmer survey data.
        </p>

        <div className="chat-window">
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                marginBottom: '1rem',
                display: 'flex',
                justifyContent: msg.type === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '70%',
                  padding: '0.75rem 1rem',
                  borderRadius: '0.5rem',
                  background: msg.type === 'user' ? '#2ecc71' : '#ecf0f1',
                  color: msg.type === 'user' ? 'white' : '#2c3e50',
                  whiteSpace: 'pre-wrap',
                  wordWrap: 'break-word',
                }}
              >
                {renderMessageContent(msg.text)}
              </div>
            </div>
          ))}

          {loading && (
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '0.6rem' }}>
                <div style={{ maxWidth: '60%' }}>
                  <Line />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="chat-input-row">
          <input
            type="text"
            placeholder="Ask a question about farmer survey data..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !loading) {
                handleSendMessage();
              }
            }}
            disabled={loading}
          />
          <button onClick={handleSendMessage} disabled={loading}>
            {loading ? '⏳ Loading' : '📤 Send'}
          </button>
        </div>
      </div>

      <div className="card">
        <SectionTitle icon="queries" title="Example Queries" />
        <ul style={{ lineHeight: '2' }}>
          <li>📌 "Show seed usage by region"</li>
          <li>📌 "Which regions use the most fertilizer?"</li>
          <li>📌 "Summarize responses for Telangana"</li>
          <li>📌 "Compare crop distribution across regions"</li>
          <li>📌 "Export this analysis to Excel"</li>
        </ul>
      </div>


    </div>
  );
}
