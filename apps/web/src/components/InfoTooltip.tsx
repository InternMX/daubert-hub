import { InfoOutlined } from '@mui/icons-material';
import { IconButton, Tooltip } from '@mui/material';

interface InfoTooltipProps {
  // Names the concept the icon explains; becomes the accessible name ("Información: <label>").
  label: string;
  // Help text. "\n" starts a new line (rendered as-is, so short lists stay readable).
  text: string;
}

// Small, discreet info icon with an explanatory tooltip. It is a real (type="button") control, so it takes
// keyboard focus and the tooltip opens on focus as well as on hover; the text is also exposed through
// aria-describedby, so nothing depends on color or on hovering. Place it NEXT TO a control's label, never
// inside a <label> (it would otherwise change that control's accessible name and toggle it on click).
export function InfoTooltip({ label, text }: InfoTooltipProps) {
  return (
    <Tooltip
      describeChild
      arrow
      placement="top"
      enterTouchDelay={0}
      title={text}
      slotProps={{ tooltip: { sx: { maxWidth: 360, fontSize: '0.8125rem', lineHeight: 1.45, whiteSpace: 'pre-line' } } }}
    >
      <IconButton type="button" size="small" aria-label={`Información: ${label}`} sx={{ p: 0.25, color: 'text.secondary', '&:hover, &:focus-visible': { color: 'primary.main' } }}>
        <InfoOutlined sx={{ fontSize: 16 }} />
      </IconButton>
    </Tooltip>
  );
}
