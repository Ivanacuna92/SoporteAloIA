-- Migration: Add quoted message support
-- Description: Adds columns to support quoted/replied messages

ALTER TABLE conversation_logs ADD COLUMN IF NOT EXISTS has_quoted_msg BOOLEAN DEFAULT FALSE;
ALTER TABLE conversation_logs ADD COLUMN IF NOT EXISTS quoted_msg_body TEXT;
ALTER TABLE conversation_logs ADD COLUMN IF NOT EXISTS quoted_msg_participant VARCHAR(255);
ALTER TABLE conversation_logs ADD COLUMN IF NOT EXISTS quoted_msg_id VARCHAR(255);

-- Show updated columns
SHOW COLUMNS FROM conversation_logs;
