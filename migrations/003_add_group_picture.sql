-- Migración: Agregar campo group_picture a client_assignments
-- Fecha: 2025-10-30
-- Descripción: Agrega columna para almacenar URL de foto de perfil del grupo

ALTER TABLE client_assignments
ADD COLUMN group_picture TEXT NULL
AFTER group_name;
