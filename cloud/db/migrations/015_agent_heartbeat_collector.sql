ALTER TABLE agent_heartbeats ADD COLUMN collector_enabled INTEGER;
ALTER TABLE agent_heartbeats ADD COLUMN collector_index INTEGER;
ALTER TABLE agent_heartbeats ADD COLUMN collector_last_target_key TEXT;
ALTER TABLE agent_heartbeats ADD COLUMN collector_last_target_url TEXT;
ALTER TABLE agent_heartbeats ADD COLUMN collector_last_targets_json TEXT;
ALTER TABLE agent_heartbeats ADD COLUMN collector_updated_at INTEGER;
