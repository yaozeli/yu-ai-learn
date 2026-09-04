-- Migration 002: wrong-question review sessions
--
-- Add a nullable marker column to quiz_sessions. A session whose
-- review_for_wrong_question_id is set is a single-question review created by
-- POST /api/v1/wrong-questions/{wrong_question_id}/retry. It is excluded from
-- the history and in-progress lists. The column deliberately has no FOREIGN
-- KEY: deleting the linked wrong-question row happens in the same transaction
-- as the answer that masters it.
--
-- Idempotent guard for MySQL 8: INFORMATION_SCHEMA check then ALTER.
-- Run with: mysql -u <user> -p <yu-ai-learn> < 002_add_quiz_review_column.sql

SET @db := DATABASE();

SET @col_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @db
      AND TABLE_NAME = 'quiz_sessions'
      AND COLUMN_NAME = 'review_for_wrong_question_id'
);

SET @sql := IF(@col_exists = 0,
    'ALTER TABLE quiz_sessions
        ADD COLUMN review_for_wrong_question_id CHAR(36) NULL DEFAULT NULL,
        ADD KEY idx_quiz_sessions_review (review_for_wrong_question_id)',
    'SELECT ''column already exists''');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
