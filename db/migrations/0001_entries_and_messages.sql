-- Holographic storage, first shape.
-- Entries are saved thoughts or chats; messages belong to chats in order.
-- Ids are text so entries created in a browser keep their ids when migrated.
-- `author` is reserved for the access model and stays null until identity exists.

create table entries (
  id          text primary key,
  kind        text not null check (kind in ('chat', 'saved')),
  title       text not null,
  body        text,                       -- the text of a saved thought; null for chats
  author      text,                       -- who made it, once the access model exists
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  imported_at timestamptz,                -- set when brought in from a browser export
  constraint entries_body_matches_kind check ((kind = 'saved') = (body is not null))
);

create index entries_updated_at_idx on entries (updated_at desc);

create table messages (
  id          text primary key,
  entry_id    text not null references entries (id) on delete cascade,
  seq         integer not null,           -- 0-based position within the chat
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  note        text,                       -- why a message got no reply, when that happened
  author      text,
  created_at  timestamptz not null,
  unique (entry_id, seq)
);
