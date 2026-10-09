CREATE TYPE "public"."booking_mode" AS ENUM('site_visit', 'studio', 'video');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('booked', 'confirmed', 'held', 'reassigned', 'cancelled', 'completed', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."call_origin" AS ENUM('live', 'simulation');--> statement-breakpoint
CREATE TYPE "public"."call_status" AS ENUM('in_progress', 'completed', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."cost_provider" AS ENUM('vaani', 'gemini', 'telephony', 'other');--> statement-breakpoint
CREATE TYPE "public"."deal_stage" AS ENUM('consult_booked', 'consult_done', 'proposal_sent', 'won', 'lost', 'nurture');--> statement-breakpoint
CREATE TYPE "public"."route" AS ENUM('book', 'book_with_note', 'review', 'nurture', 'close', 'escalate', 'log');--> statement-breakpoint
CREATE TYPE "public"."task_kind" AS ENUM('escalation', 'review', 'booking_failed', 'mismatch', 'unconfirmed', 'nurture_due', 'guardrail');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('green', 'amber', 'red', 'not_a_lead');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid,
	"caller_id" uuid NOT NULL,
	"designer_id" uuid,
	"calcom_booking_uid" text,
	"starts_at" timestamp with time zone NOT NULL,
	"mode" "booking_mode" DEFAULT 'studio' NOT NULL,
	"status" "booking_status" DEFAULT 'booked' NOT NULL,
	"auto_booked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_calcomBookingUid_unique" UNIQUE("calcom_booking_uid")
);
--> statement-breakpoint
CREATE TABLE "callers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"is_existing_client" boolean DEFAULT false NOT NULL,
	"last_summary" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "callers_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vaani_call_id" text NOT NULL,
	"caller_id" uuid,
	"origin" "call_origin" DEFAULT 'live' NOT NULL,
	"status" "call_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_sec" integer,
	"after_hours" boolean DEFAULT false NOT NULL,
	"language" text,
	"transcript" text,
	"recording_url" text,
	"raw_payload" jsonb,
	"process_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calls_vaaniCallId_unique" UNIQUE("vaani_call_id")
);
--> statement-breakpoint
CREATE TABLE "costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid,
	"provider" "cost_provider" NOT NULL,
	"units" numeric NOT NULL,
	"unit_label" text NOT NULL,
	"amount_inr" numeric NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caller_id" uuid NOT NULL,
	"qualification_id" uuid,
	"stage" "deal_stage" NOT NULL,
	"estimated_value_inr" integer,
	"source" text,
	"referrer" text,
	"follow_up_on" date,
	"lost_reason" text,
	"hubspot_deal_id" text,
	"hubspot_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "designers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"telegram_chat_id" text,
	"calcom_user_id" text,
	"specialties" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "task_kind" DEFAULT 'escalation' NOT NULL,
	"call_id" uuid,
	"caller_id" uuid,
	"reason" text NOT NULL,
	"priority" text DEFAULT 'high' NOT NULL,
	"owner" text,
	"due_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"last_alerted_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"qualification_id" uuid NOT NULL,
	"booking_id" uuid,
	"designer_id" uuid NOT NULL,
	"telegram_message_id" text,
	"message_html" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirm_by" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"overdue_alerted_at" timestamp with time zone,
	"reassigned_at" timestamp with time zone,
	"lead_quality" text
);
--> statement-breakpoint
CREATE TABLE "qualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"extracted" jsonb NOT NULL,
	"criteria" jsonb NOT NULL,
	"verdict" "verdict" NOT NULL,
	"route" "route" NOT NULL,
	"flags" text[] DEFAULT '{}' NOT NULL,
	"handoff_note" text,
	"estimated_value_inr" integer,
	"agent_booked" boolean DEFAULT false NOT NULL,
	"mismatch" boolean DEFAULT false NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qualifications_callId_unique" UNIQUE("call_id")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_caller_id_callers_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."callers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_designer_id_designers_id_fk" FOREIGN KEY ("designer_id") REFERENCES "public"."designers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_caller_id_callers_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."callers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "costs" ADD CONSTRAINT "costs_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_caller_id_callers_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."callers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_qualification_id_qualifications_id_fk" FOREIGN KEY ("qualification_id") REFERENCES "public"."qualifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_caller_id_callers_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."callers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_qualification_id_qualifications_id_fk" FOREIGN KEY ("qualification_id") REFERENCES "public"."qualifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_designer_id_designers_id_fk" FOREIGN KEY ("designer_id") REFERENCES "public"."designers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_caller_id_index" ON "calls" USING btree ("caller_id");--> statement-breakpoint
CREATE INDEX "calls_started_at_index" ON "calls" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "costs_occurred_at_index" ON "costs" USING btree ("occurred_at");