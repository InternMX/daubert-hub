import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { listAutomationsOverview, type AutomationOverview } from '../services/automationsOverview';
import { AUTOMATION_ROUTE_BY_CODE, MANUFACTURING_SHEETS_ROUTE, MANUFACTURING_UI_VISIBLE } from './automationRoutes';
import { automationHealthAccent, automationHealthTexts, formatCardTimestamp, lifecycleStatusLabel, processingOutcomeLabel } from './automationOverviewPresentation';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 40%) 1fr', columnGap: 1.5, py: 0.375 }}>
      <Typography color="text.secondary" variant="body2">{label}</Typography>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{value}</Typography>
    </Box>
  );
}

// Flex column + height:100% makes every card in a grid row stretch to the tallest one (the grid's
// own default `align-items: stretch`), and mt:'auto' on the action row pins it to the bottom even
// when descriptions/metadata rows differ in count between automations.
//
// The operational accent (Phase 10I UX refinement §2) is a restrained left border strip, paired
// with explicit text below (never color as the sole indicator) — never a traffic-light circle, and
// never a green "healthy" accent. /automations is monitoring/navigation only: acknowledging a
// problem now lives on the automation's own processing-history table (AudiRemissionsPage /
// PaymentNotificationsPage), not here.
function AutomationCard({ automation }: { automation: AutomationOverview }) {
  // Gated by capabilities.hasDashboard, not merely by the code appearing in AUTOMATION_ROUTE_BY_CODE
  // — a route existing here but the backend not yet reporting hasDashboard=true would otherwise
  // show a link the catalog doesn't consider ready (Phase 12A.4 §E).
  const route = automation.capabilities.hasDashboard ? AUTOMATION_ROUTE_BY_CODE[automation.code] : undefined;
  const lifecycleLabel = lifecycleStatusLabel(automation.lifecycleStatus);
  const accent = automationHealthAccent(automation);
  const healthTexts = automationHealthTexts(automation);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 2.5, sm: 3 },
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderLeftWidth: accent ? 4 : 1,
        borderLeftColor: accent ? `${accent}.main` : 'divider'
      }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} spacing={1}>
        <Typography variant="h2" sx={{ fontSize: '1.125rem' }}>{automation.name}</Typography>
        {lifecycleLabel && <Chip label={lifecycleLabel} color={lifecycleLabel === 'Activa' ? 'success' : 'default'} size="small" />}
        {automation.integrationStatus === 'NOT_INTEGRATED' && <Chip label="Sin integración con Hub" color="default" size="small" />}
        {automation.integrationStatus === 'IN_PREPARATION' && <Chip label="Integración en preparación" color="default" size="small" />}
      </Stack>
      <Typography color="text.secondary" variant="body2" sx={{ mt: 0.75 }}>{automation.description}</Typography>
      <Stack sx={{ mt: 2 }}>
        <Row label="Entorno" value={automation.environment} />
        <Row label="Frecuencia" value={automation.polling.label} />
        {automation.lastCheckAt && <Row label="Última revisión" value={formatCardTimestamp(automation.lastCheckAt)} />}
        {automation.nextCheckAt && <Row label="Próxima revisión" value={formatCardTimestamp(automation.nextCheckAt)} />}
        {automation.lastProcessing && <Row label="Último procesamiento" value={formatCardTimestamp(automation.lastProcessing.occurredAt)} />}
        {automation.lastProcessing && <Row label="Resultado" value={processingOutcomeLabel(automation.lastProcessing.outcome)} />}
      </Stack>
      {healthTexts.length > 0 && (
        <Stack sx={{ mt: 1.5 }} spacing={0.5}>
          {healthTexts.map((item) => (
            <Typography key={item.text} variant="body2" fontWeight={600} color={`${item.color}.main`}>{item.text}</Typography>
          ))}
        </Stack>
      )}
      {automation.integrationStatus !== 'INTEGRATED' && (
        <Typography color="text.secondary" variant="body2" sx={{ mt: 2 }}>Daubert Hub todavía no recibe información operacional de esta automatización.</Typography>
      )}
      <Box sx={{ mt: 'auto', pt: route ? 2.5 : 0 }}>
        {route && <Button component={Link} to={route} variant="contained">Ver automatización</Button>}
      </Box>
    </Paper>
  );
}

// «Hojas de manufactura» es un PROCESO ASISTIDO (lo opera una persona desde el gestor), no un workflow de n8n: no tiene horario, ejecuciones ni estado de procesamiento, así que esta tarjeta no los
// inventa. Es estática a propósito (no sale del catálogo de automatizaciones) y reutiliza el patrón visual de las demás tarjetas. Su actividad (hojas creadas y finalizadas) vive en «Actividad reciente».
function AssistedProcessCard() {
  if (!MANUFACTURING_UI_VISIBLE) return null;
  return (
    <Paper variant="outlined" data-testid="assisted-process-card" sx={{ p: { xs: 2.5, sm: 3 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} spacing={1}>
        <Typography variant="h2" sx={{ fontSize: '1.125rem' }}>Hojas de manufactura</Typography>
        <Chip label="Proceso asistido" size="small" />
      </Stack>
      <Typography color="text.secondary" variant="body2" sx={{ mt: 0.75 }}>Elabora, revisa y finaliza las hojas de instrucción de manufactura a partir del código DCMX, con historial de revisiones y PDF.</Typography>
      <Stack sx={{ mt: 2 }}>
        <Row label="Tipo" value="Asistido por una persona" />
        <Row label="Ejecución" value="Bajo demanda (no programada)" />
      </Stack>
      <Box sx={{ mt: 'auto', pt: 2.5 }}>
        <Button component={Link} to={MANUFACTURING_SHEETS_ROUTE} variant="contained">Abrir gestor</Button>
      </Box>
    </Paper>
  );
}

// Total/integrated/not-integrated counts were removed (Phase 10F cleanup): they duplicated
// information already visible on each card. Only an actionable signal remains: a single
// restrained warning notice, shown only when at least one automation's review state (Phase 10I;
// backend-authoritative, never re-derived here) is required. Zero never renders anything
// ("0 requieren revisión" would be noise, not information), and there is no green/success
// counterpart for a healthy state — the absence of the notice already says that.
function ReviewNotice({ automations }: { automations: AutomationOverview[] }) {
  const reviewCount = automations.filter((automation) => automation.review.required).length;
  if (reviewCount === 0) return null;

  const message = reviewCount === 1
    ? '1 automatización requiere revisión'
    : `${reviewCount} automatizaciones requieren revisión`;

  return <Alert severity="warning" sx={{ mt: 3, maxWidth: 760 }}>{message}</Alert>;
}

export function AutomationsPage() {
  const [automations, setAutomations] = useState<AutomationOverview[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    listAutomationsOverview()
      .then((response) => { if (active) setAutomations(response); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Automatizaciones' }]} />
      <PageHeader title="Automatizaciones" description="Supervisión de procesos automatizados." />
      {loading && <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Cargando automatizaciones" /></Box>}
      {!loading && error && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>} sx={{ mt: 4, maxWidth: 760 }}>
          No fue posible cargar las automatizaciones. Intenta nuevamente.
        </Alert>
      )}
      {!loading && !error && automations && automations.length === 0 && (
        <>
          <EmptyState title="Aún no hay automatizaciones registradas." description="Cuando haya automatizaciones disponibles, aparecerán aquí." />
          <Box sx={{ mt: 3, maxWidth: 520 }}><AssistedProcessCard /></Box>
        </>
      )}
      {!loading && !error && automations && automations.length > 0 && (
        <>
          <ReviewNotice automations={automations} />
          <Box
            data-testid="automations-grid"
            sx={{
              mt: 3,
              display: 'grid',
              gap: 3,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }
            }}
          >
            {automations.map((automation) => <AutomationCard key={automation.code} automation={automation} />)}
            <AssistedProcessCard />
          </Box>
        </>
      )}
    </>
  );
}
