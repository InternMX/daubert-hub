import { apiBaseUrl } from './api';

export type RecentActivityType = 'PROVIDER_CREATED' | 'PROVIDER_UPDATED' | 'CONTACT_CREATED' | 'CONTACT_UPDATED' | 'CONTACT_METHOD_ADDED' | 'CONTACT_METHOD_UPDATED' | 'CONTACT_METHOD_DEACTIVATED' | 'CONTACT_METHOD_REACTIVATED' | 'AUTOMATION_COMPLETED' | 'AUTOMATION_PARTIAL' | 'AUTOMATION_FAILED';
export type RecentActivityCategory = 'PROVIDER' | 'CONTACT' | 'AUTOMATION' | 'CLIENT';

export interface RecentActivityItem {
  type: RecentActivityType;
  category: RecentActivityCategory;
  title: string;
  entity: string;
  context: string | null;
  occurredAt: string;
}

const activityTypes = new Set<RecentActivityType>(['PROVIDER_CREATED', 'PROVIDER_UPDATED', 'CONTACT_CREATED', 'CONTACT_UPDATED', 'CONTACT_METHOD_ADDED', 'CONTACT_METHOD_UPDATED', 'CONTACT_METHOD_DEACTIVATED', 'CONTACT_METHOD_REACTIVATED', 'AUTOMATION_COMPLETED', 'AUTOMATION_PARTIAL', 'AUTOMATION_FAILED']);
const activityCategories = new Set<RecentActivityCategory>(['PROVIDER', 'CONTACT', 'AUTOMATION', 'CLIENT']);

function isRecentActivityItem(value: unknown): value is RecentActivityItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.type === 'string' && activityTypes.has(item.type as RecentActivityType)
    && typeof item.category === 'string' && activityCategories.has(item.category as RecentActivityCategory)
    && typeof item.title === 'string' && typeof item.entity === 'string'
    && (item.context === null || typeof item.context === 'string')
    && typeof item.occurredAt === 'string' && Number.isFinite(new Date(item.occurredAt).getTime());
}

export async function listRecentActivity(limit = 6): Promise<RecentActivityItem[]> {
  let response: Response;
  try { response = await fetch(`${apiBaseUrl}/recent-activity?${new URLSearchParams({ limit: String(limit) })}`); }
  catch { throw new Error('RECENT_ACTIVITY_UNAVAILABLE'); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('data' in body) || !Array.isArray(body.data) || !body.data.every(isRecentActivityItem)) throw new Error('RECENT_ACTIVITY_UNAVAILABLE');
  return body.data;
}
