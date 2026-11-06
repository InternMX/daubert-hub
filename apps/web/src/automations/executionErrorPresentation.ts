// Presentation constants for long execution errors (kept apart from the components for fast refresh).

export const executionErrorPreviewSx = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  whiteSpace: 'normal',
  maxWidth: '100%'
} as const;

export const executionErrorCellSx = { width: 280, minWidth: 180, maxWidth: 280, verticalAlign: 'top' } as const;
