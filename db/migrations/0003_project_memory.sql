-- Project memory, first experiment.
-- Candidate memories are proposed from a conversation, tied to the message and
-- verbatim quote that support them; only accepted ones count as established.
-- A correction never edits history: it supersedes a memory with a new row and
-- every change is recorded in memory_events.

create table projects (
  id         text primary key,
  name       text not null,
  created_at timestamptz not null default now()
);

create table memories (
  id             text primary key,
  project_id     text not null references projects (id) on delete cascade,
  kind           text not null check (kind in ('decision', 'open')),       -- decision, or open idea / question
  status         text not null check (status in ('suggested', 'accepted', 'rejected', 'superseded')),
  text           text not null,            -- current wording
  original_text  text not null,            -- wording as first proposed; never changed
  attributed_to  text not null check (attributed_to in ('person', 'assistant', 'quoted')),
  proposed_by    text not null check (proposed_by in ('model', 'person')),
  source_entry_id   text references entries (id) on delete set null,
  source_message_id text,
  source_quote      text,                   -- verbatim passage from the source message
  supersedes     text references memories (id),
  note           text,                     -- reviewer's note on a correction
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index memories_project_status_idx on memories (project_id, status, updated_at desc);

create table memory_events (
  id         bigserial primary key,
  memory_id  text not null references memories (id) on delete cascade,
  action     text not null check (action in ('proposed', 'accepted', 'rejected', 'edited', 'superseded', 'created')),
  from_text  text,
  to_text    text,
  note       text,
  at         timestamptz not null default now()
);

-- Which memories informed an assistant reply (list of memory ids), like sources.
alter table messages add column memory_refs jsonb;
