import React from 'react';

const ULISES_REGEX = /(ulises|uli)/gi;
const RAINBOW_COLORS = [
  '#FF0000', '#FF8C00', '#FFD700', '#008000',
  '#0000FF', '#4B0082', '#8B00FF'
];

function getRainbowStyle(charIndex) {
  const color = RAINBOW_COLORS[charIndex % RAINBOW_COLORS.length];
  return {
    color,
    display: 'inline-block',
    animation: `rainbow-wave 2s linear infinite`,
    animationDelay: `${charIndex * 0.06}s`
  };
}

export function highlightUlises(text) {
  if (!text || typeof text !== 'string') return text;

  const parts = [];
  let lastIndex = 0;
  let match;

  const regex = new RegExp(ULISES_REGEX.source, ULISES_REGEX.flags);
  let partKey = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const matched = match[0];
    const chars = matched.split('');
    parts.push(
      <React.Fragment key={`rainbow-${partKey}`}>
        <span style={{ marginRight: '2px' }}>🏳️‍🌈</span>
        {chars.map((char, i) => (
          <span
            key={i}
            style={getRainbowStyle(i)}
            className="rainbow-char"
          >
            {char}
          </span>
        ))}
        <span style={{ marginLeft: '2px' }}>🏳️‍⚧️</span>
      </React.Fragment>
    );

    partKey++;
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  if (parts.length === 0) return text;
  if (parts.length === 1 && typeof parts[0] === 'string') return text;

  return parts.length === 1 ? parts[0] : parts;
}

export function processChildrenForUlises(children, keyPrefix = '') {
  if (children == null) return children;

  if (typeof children === 'string') {
    return highlightUlises(children);
  }

  if (Array.isArray(children)) {
    return children.map((child, i) =>
      processChildrenForUlises(child, `${keyPrefix}${i}`)
    );
  }

  if (React.isValidElement(children)) {
    const childProps = children.props;
    if (childProps && childProps.children) {
      return React.cloneElement(
        children,
        { key: children.key || keyPrefix },
        processChildrenForUlises(childProps.children, `${keyPrefix}c`)
      );
    }
    return children;
  }

  return children;
}

export default highlightUlises;
