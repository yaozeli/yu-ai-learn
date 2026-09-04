-- Yu AI Learn database initialization
-- MySQL 8.x / utf8mb4
-- This script is idempotent and does not insert demo users or learning data.

CREATE DATABASE IF NOT EXISTS `yu-ai-learn`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE `yu-ai-learn`;

CREATE TABLE IF NOT EXISTS schema_versions (
    version INT UNSIGNED NOT NULL,
    description VARCHAR(255) NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) NOT NULL,
    openid VARCHAR(128) NOT NULL,
    nickname VARCHAR(64) NOT NULL DEFAULT '',
    avatar_url VARCHAR(512) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_openid (openid),
    KEY idx_users_last_login_at (last_login_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS quiz_sessions (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    topic VARCHAR(500) NOT NULL,
    title VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL,
    source_type VARCHAR(32) NOT NULL DEFAULT 'text',
    status VARCHAR(32) NOT NULL DEFAULT 'in_progress',
    question_count SMALLINT UNSIGNED NOT NULL,
    correct_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    accuracy DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    total_duration_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
    review_for_wrong_question_id CHAR(36) NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP NULL DEFAULT NULL,
    completed_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_quiz_sessions_user_created (user_id, created_at),
    KEY idx_quiz_sessions_user_status (user_id, status),
    KEY idx_quiz_sessions_review (review_for_wrong_question_id),
    CONSTRAINT fk_quiz_sessions_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_quiz_sessions_status
        CHECK (status IN ('in_progress', 'completed', 'report_pending', 'failed')),
    CONSTRAINT chk_quiz_sessions_accuracy
        CHECK (accuracy >= 0.00 AND accuracy <= 100.00),
    CONSTRAINT chk_quiz_sessions_source_type
        CHECK (source_type = 'text')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS question_snapshots (
    id CHAR(36) NOT NULL,
    quiz_session_id CHAR(36) NOT NULL,
    question_id VARCHAR(64) NOT NULL,
    question_order SMALLINT UNSIGNED NOT NULL,
    question_type VARCHAR(16) NOT NULL,
    stem TEXT NOT NULL,
    options JSON NOT NULL,
    correct_answers JSON NOT NULL,
    explanation TEXT NOT NULL,
    knowledge_point VARCHAR(255) NOT NULL,
    difficulty VARCHAR(16) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_question_snapshots_session_question (quiz_session_id, question_id),
    UNIQUE KEY uq_question_snapshots_session_order (quiz_session_id, question_order),
    KEY idx_question_snapshots_session (quiz_session_id),
    CONSTRAINT fk_question_snapshots_session
        FOREIGN KEY (quiz_session_id) REFERENCES quiz_sessions (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_question_snapshots_type
        CHECK (question_type IN ('single', 'multiple', 'judge')),
    CONSTRAINT chk_question_snapshots_difficulty
        CHECK (difficulty IN ('easy', 'medium', 'hard'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS answer_records (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    quiz_session_id CHAR(36) NOT NULL,
    question_snapshot_id CHAR(36) NOT NULL,
    selected_answers JSON NOT NULL,
    is_correct BOOLEAN NOT NULL,
    duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_answer_records_session_question (quiz_session_id, question_snapshot_id),
    KEY idx_answer_records_user_submitted (user_id, submitted_at),
    KEY idx_answer_records_session (quiz_session_id),
    CONSTRAINT fk_answer_records_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_answer_records_session
        FOREIGN KEY (quiz_session_id) REFERENCES quiz_sessions (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_answer_records_question
        FOREIGN KEY (question_snapshot_id) REFERENCES question_snapshots (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS reports (
    id CHAR(36) NOT NULL,
    quiz_session_id CHAR(36) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    accuracy DECIMAL(5,2) NOT NULL,
    mastered_points JSON NOT NULL,
    weak_points JSON NOT NULL,
    three_line_summary JSON NOT NULL,
    advice JSON NOT NULL,
    share_quote VARCHAR(500) NOT NULL DEFAULT '',
    generation_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_reports_quiz_session (quiz_session_id),
    KEY idx_reports_status_updated (status, updated_at),
    CONSTRAINT fk_reports_session
        FOREIGN KEY (quiz_session_id) REFERENCES quiz_sessions (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_reports_status
        CHECK (status IN ('pending', 'completed', 'failed')),
    CONSTRAINT chk_reports_accuracy
        CHECK (accuracy >= 0.00 AND accuracy <= 100.00)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS wrong_questions (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    question_snapshot_id CHAR(36) NOT NULL,
    first_wrong_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_wrong_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    wrong_count INT UNSIGNED NOT NULL DEFAULT 1,
    review_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_wrong_questions_user_question (user_id, question_snapshot_id),
    KEY idx_wrong_questions_user_review (user_id, review_at),
    CONSTRAINT fk_wrong_questions_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_wrong_questions_snapshot
        FOREIGN KEY (question_snapshot_id) REFERENCES question_snapshots (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO schema_versions (version, description)
VALUES (1, 'Initial user and learning data schema')
ON DUPLICATE KEY UPDATE description = VALUES(description);
