import { apiBaseUrl } from './api';

export type RecentActivityType = 'PROVIDER_CREATED' | 'PROVIDER_UPDATED' | 'PROVIDER_DEACTIVATED' | 'PROVIDER_REACTIVATED' | 'CLIENT_CREATED' | 'CLIENT_UPDATED' | 'CLIENT_DEACTIVATED' | 'CLIENT_REACTIVATED' | 'CONTACT_CREATED' | 'CONTACT_UPDATED' | 'CONTACT_DEACTIVATED' | 'CONTACT_REACTIVATED' | 'CONTACT_METHOD_ADDED' | 'CONTACT_METHOD_UPDATED' | 'CONTACT_METHOD_DEACTIVATED' | 'CONTACT_METHOD_REACTIVATED' | 'AUTOMATION_COMPLETED' | 'AUTOMATION_PARTIAL' | 'AUTOMATION_FAILED' | 'AUTOMATION_CANCELLED' | 'DOCUMENT_SERIES_ADJUSTED';
export type RecentActivityCategory = 'PROVIDER' | 'CONTACT' | 'AUTOMATION' | 'CLIENT';

// Present only for events with a known human actor. displayName is a best-effort current lookup
// (may be null even when id/email are known); email is the historical snapshot from when the
// event occurred. A system/automation-generated event (no human actor at all) has actor = null.
export interface RecentActivityActor {
  id: string | null;
  displayName: string | null;
  email: string | null;
}

export interface RecentActivityItem {
  type: RecentActivityType;
  category: RecentActivityCategory;
  title: string;
  entity: string;
  context: string | null;
  occurredAt: string;
  actor: RecentActivityActor | null;
}

const activityTypes = new Set<RecentActivityType>(['PROVIDER_CREATED', 'PROVIDER_UPDATED', 'PROVIDER_DEACTIVATED', 'PROVIDER_REACTIVATED', 'CLIENT_CREATED', 'CLIENT_UPDATED', 'CLIENT_DEACTIVATED', 'CLIENT_REACTIVATED', 'CONTACT_CREATED', 'CONTACT_UPDATED', 'CONTACT_DEACTIVATED', 'CONTACT_REACTIVATED', 'CONTACT_METHOD_ADDED', 'CONTACT_METHOD_UPDATED', 'CONTACT_METHOD_DEACTIVATED', 'CONTACT_METHOD_REACTIVATED', 'AUTOMATION_COMPLETED', 'AUTOMATION_PARTIAL', 'AUTOMATION_FAILED', 'AUTOMATION_CANCELLED', 'DOCUMENT_SERIES_ADJUSTED']);
const activityCategories = new Set<RecentActivityCategory>(['PROVIDER', 'CONTACT', 'AUTOMATION', 'CLIENT']);

function isRecentActivityActor(value: unknown): value is RecentActivityActor {
  if (typeof value !== 'object' || value === null) return false;
  const actor = value as Record<string, unknown>;
  return (actor.id === null || typeof actor.id === 'string')
    && (actor.displayName === null || typeof actor.displayName === 'string')
    && (actor.email === null || typeof actor.email === 'string');
}

function isRecentActivityItem(value: unknown): value is RecentActivityItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.type === 'string' && activityTypes.has(item.type as RecentActivityType)
    && typeof item.category === 'string' && activityCategories.has(item.category as RecentActivityCategory)
    && typeof item.title === 'string' && typeof item.entity === 'string'
    && (item.context === null || typeof item.context === 'string')
    && typeof item.occurredAt === 'string' && Number.isFinite(new Date(item.occurredAt).getTime())
    && (item.actor === null || isRecentActivityActor(item.actor));
}

export async function listRecentActivity(limit = 6, category?: RecentActivityCategory): Promise<RecentActivityItem[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (category) query.set('category', category);
  let response: Response;
  try { response = await fetch(`${apiBaseUrl}/recent-activity?${query}`); }
  catch { throw new Error('RECENT_ACTIVITY_UNAVAILABLE'); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('data' in body) || !Array.isArray(body.data) || !body.data.every(isRecentActivityItem)) throw new Error('RECENT_ACTIVITY_UNAVAILABLE');
  return body.data;
}
