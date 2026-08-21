-- Add notes column to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes TEXT;
