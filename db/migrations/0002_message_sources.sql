-- Which saved entries were quoted to the model for an assistant reply.
-- A JSON array of {id, title, page?}; null when retrieval did not run.
alter table messages add column sources jsonb;
