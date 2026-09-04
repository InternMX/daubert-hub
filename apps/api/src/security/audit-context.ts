// Carries the same app.origin / app.request_id / app.user_id / app.user_email
// session variables every other repository's transaction() helper sets before
// a mutation, so security.users mutations flow into audit.cambios (via the
// dedicated, sanitized trg_audit_users trigger) exactly like every other
// audited table. actorUserId/actorUserEmail are legitimately null when there
// is no authenticated caller yet (e.g. the bootstrap script).
export interface AuditContext {
  requestId: string;
  origin: string;
  actorUserId: string | null;
  actorUserEmail: string | null;
}
