-- Remove tenant_settings rows that only restate the platform default.
--
-- Support cannot tell a deliberate choice from a leftover, and every redundant
-- row is one more thing to keep in step when a default changes. Anything that
-- differs from the default is left alone.
delete from tenant_settings where key = 'retry_attempts' and value = '3';
--> statement-breakpoint
delete from tenant_settings where key = 'retry_interval_days' and value = '3';
