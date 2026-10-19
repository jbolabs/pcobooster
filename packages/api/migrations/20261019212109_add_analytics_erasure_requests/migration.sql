CREATE TABLE `analytics_erasure_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`distinct_id` text,
	`requested_at` integer NOT NULL,
	`next_attempt_at` integer,
	`passes_completed` integer DEFAULT 0 NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `analytics_erasure_requests_due_idx` ON `analytics_erasure_requests` (`next_attempt_at`);