-- Migración 009 — Marca de cuándo el bot fue removido del grupo
-- Fecha: 2026-10-16
-- Independiente de is_archived: un chat puede estar archivado y seguir
-- teniendo al bot adentro (archivado por operación), o puede estar sin
-- archivar pero con el bot sacado (debe desaparecer del panel de asignaciones).

ALTER TABLE client_assignments
  ADD COLUMN bot_left_group_at DATETIME NULL DEFAULT NULL AFTER is_archived,
  ADD INDEX idx_bot_left_group_at (bot_left_group_at);
