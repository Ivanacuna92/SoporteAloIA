-- Migración: Agregar soporte de archivado a client_assignments
-- Fecha: 2026-06-08
-- Descripción: Agrega columna is_archived para que cada support_user pueda archivar conversaciones (grupos) y mantener la bandeja principal limpia.

ALTER TABLE client_assignments
ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE
AFTER group_picture;

ALTER TABLE client_assignments
ADD INDEX idx_is_archived (is_archived);
