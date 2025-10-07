CREATE TABLE `access_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`member_id` text,
	`card_id` text,
	`at` text NOT NULL,
	`local_day` text NOT NULL,
	`result` text NOT NULL,
	`reason` text NOT NULL,
	`source` text NOT NULL,
	`provider` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `access_events_site_day_idx` ON `access_events` (`site_id`,`local_day`);--> statement-breakpoint
CREATE INDEX `access_events_member_idx` ON `access_events` (`member_id`);--> statement-breakpoint
CREATE INDEX `access_events_tenant_at_idx` ON `access_events` (`tenant_id`,`at`);--> statement-breakpoint
CREATE TABLE `access_sync_state` (
	`site_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`last_synced_at` text,
	`last_success_at` text,
	`pending_changes` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`class_id` text NOT NULL,
	`member_id` text NOT NULL,
	`status` text NOT NULL,
	`position` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bookings_class_idx` ON `bookings` (`class_id`,`status`);--> statement-breakpoint
CREATE INDEX `bookings_member_idx` ON `bookings` (`member_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_class_member_idx` ON `bookings` (`class_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `charges` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`payment_run_id` text NOT NULL,
	`member_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`method` text NOT NULL,
	`failure_code` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`attempted_at` text NOT NULL,
	`next_attempt_at` text,
	`settled_at` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_run_id`) REFERENCES `payment_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `charges_run_idx` ON `charges` (`payment_run_id`);--> statement-breakpoint
CREATE INDEX `charges_member_idx` ON `charges` (`member_id`);--> statement-breakpoint
CREATE INDEX `charges_tenant_status_idx` ON `charges` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `charges_next_attempt_idx` ON `charges` (`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`instructor_id` text,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`capacity` integer NOT NULL,
	`cancelled` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instructor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `classes_site_starts_idx` ON `classes` (`site_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `classes_tenant_starts_idx` ON `classes` (`tenant_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `errors` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`where` text NOT NULL,
	`message` text NOT NULL,
	`stack` text,
	`severity` text DEFAULT 'error' NOT NULL,
	`context_json` text DEFAULT '{}' NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `errors_tenant_at_idx` ON `errors` (`tenant_id`,`at`);--> statement-breakpoint
CREATE INDEX `errors_where_idx` ON `errors` (`where`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`actor_id` text,
	`actor_role` text,
	`action` text NOT NULL,
	`subject_type` text,
	`subject_id` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_tenant_at_idx` ON `events` (`tenant_id`,`at`);--> statement-breakpoint
CREATE INDEX `events_action_idx` ON `events` (`action`,`at`);--> statement-breakpoint
CREATE TABLE `freezes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`months` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `freezes_subscription_idx` ON `freezes` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `freezes_tenant_idx` ON `freezes` (`tenant_id`,`starts_on`);--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job` text NOT NULL,
	`tenant_id` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`summary_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `job_runs_job_idx` ON `job_runs` (`job`,`started_at`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`home_site_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`status` text NOT NULL,
	`card_id` text,
	`birth_year` integer NOT NULL,
	`joined_on` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`home_site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `members_tenant_idx` ON `members` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `members_site_idx` ON `members` (`home_site_id`);--> statement-breakpoint
CREATE INDEX `members_tenant_status_idx` ON `members` (`tenant_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_card_idx` ON `members` (`card_id`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`channel` text NOT NULL,
	`template` text,
	`recipient` text,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `outbox_tenant_channel_idx` ON `outbox` (`tenant_id`,`channel`,`at`);--> statement-breakpoint
CREATE TABLE `payment_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`period` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`charges_attempted` integer DEFAULT 0 NOT NULL,
	`charges_failed` integer DEFAULT 0 NOT NULL,
	`total_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`triggered_by` text DEFAULT 'schedule' NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_runs_tenant_period_idx` ON `payment_runs` (`tenant_id`,`period`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`price_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`interval` text NOT NULL,
	`binding_months` integer DEFAULT 0 NOT NULL,
	`sites_scope` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `plans_tenant_idx` ON `plans` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`charge_id` text NOT NULL,
	`member_id` text NOT NULL,
	`number` text NOT NULL,
	`issued_at` text NOT NULL,
	`currency` text NOT NULL,
	`total_minor` integer NOT NULL,
	`vat_minor` integer DEFAULT 0 NOT NULL,
	`lines_json` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`charge_id`) REFERENCES `charges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipts_number_idx` ON `receipts` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `receipts_member_idx` ON `receipts` (`member_id`);--> statement-breakpoint
CREATE TABLE `seed_meta` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`today` text NOT NULL,
	`seed` text NOT NULL,
	`scale` text NOT NULL,
	`generated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`schema_version` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`timezone` text NOT NULL,
	`address_line` text NOT NULL,
	`city` text NOT NULL,
	`access_provider` text NOT NULL,
	`opened_on` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sites_tenant_idx` ON `sites` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`member_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text NOT NULL,
	`started_on` text NOT NULL,
	`ends_on` text,
	`binding_until` text,
	`cancelled_on` text,
	`notice_ends_on` text,
	`cancel_reason` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `subscriptions_tenant_idx` ON `subscriptions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_member_idx` ON `subscriptions` (`member_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_status_idx` ON `subscriptions` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `subscriptions_cancelled_idx` ON `subscriptions` (`tenant_id`,`cancelled_on`);--> statement-breakpoint
CREATE TABLE `tenant_settings` (
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `key`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`org_number` text NOT NULL,
	`country` text NOT NULL,
	`currency` text NOT NULL,
	`locale` text NOT NULL,
	`segment` text NOT NULL,
	`plan_tier` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tenants_segment_idx` ON `tenants` (`segment`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`site_id` text,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`member_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_tenant_idx` ON `users` (`tenant_id`);