-- Migración 007 — Etiquetas de personas Aloia asignadas a chats
-- Fecha: 2026-10-16
-- Permite marcar un chat con una o varias personas del equipo Aloia como
-- responsables / interesadas, sin que sean usuarias de la plataforma.

CREATE TABLE IF NOT EXISTS chat_tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  color VARCHAR(16) NOT NULL DEFAULT '#64748B',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chat_tag_assignments (
  chat_phone VARCHAR(50) NOT NULL,
  tag_id INT NOT NULL,
  assigned_by INT NULL,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_phone, tag_id),
  INDEX idx_chat_phone (chat_phone),
  INDEX idx_tag_id (tag_id),
  FOREIGN KEY (tag_id) REFERENCES chat_tags(id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT IGNORE INTO chat_tags (name, color) VALUES
  ('Luis',      '#3B82F6'),
  ('Iván',      '#10B981'),
  ('Max',       '#F59E0B'),
  ('Ulises',    '#8B5CF6'),
  ('Juan',      '#EF4444'),
  ('Christian', '#EC4899');
