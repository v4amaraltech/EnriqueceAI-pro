-- Add 'system' to channel_type enum for lifecycle events (Perdido/Ganho) in timeline
ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'system';
