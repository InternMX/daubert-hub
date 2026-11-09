-- OPERATOR ONLY, not executed against shared TEST by this session. No password, login or role membership.
DO $$ BEGIN
  IF current_database()<>'daubert_hub_test' OR current_user<>'postgres' THEN RAISE EXCEPTION 'TEST_OWNER_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cat_recovery_test_coordinator') THEN
    CREATE ROLE cat_recovery_test_coordinator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cat_recovery_test_coordinator'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'EXISTING_COORDINATOR_ROLE_REQUIRES_REVIEW';
  END IF;
END $$;
