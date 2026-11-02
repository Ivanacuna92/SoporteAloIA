-- Migración 008 — Teléfono WhatsApp personal para cada persona del equipo Aloia
-- Fecha: 2026-10-16
-- Permite que, cuando llega un mensaje a un chat etiquetado, se envíe una
-- notificación por WhatsApp al número personal de cada persona asignada —
-- sin que el bot tenga que escribirles directo en el grupo.

ALTER TABLE chat_tags
  ADD COLUMN phone VARCHAR(32) NULL AFTER color;
