import type { Entry } from "./types";

// Built-in examples shown while the library is empty. They are labeled as
// samples in the sidebar and when opened, and are never written to storage.
const at = "2026-11-01T09:00:00.000Z";

export const SAMPLE_ENTRIES: Entry[] = [
  {
    id: "sample-chat-1",
    kind: "chat",
    sample: true,
    title: "Borrowing a sonata's structure for a chapter",
    createdAt: at,
    updatedAt: at,
    messages: [
      {
        id: "sample-chat-1-m1",
        role: "user",
        content:
          "I'm drafting a chapter that keeps returning to the same room at different hours. Could a sonata form give it a shape without feeling mechanical?",
        createdAt: at,
      },
      {
        id: "sample-chat-1-m2",
        role: "assistant",
        content:
          "It can, if you treat exposition, development, and recapitulation as moods rather than slots. Introduce the room twice early on, in two contrasting keys: once in daylight with the objects named plainly, once at night with the same objects seen sideways. The development is where those two readings argue with each other across the chapter's middle. When the room returns at the end, let the daylight description come back almost word for word, but with one object missing. Readers will feel the form without needing to name it.",
        createdAt: at,
      },
    ],
  },
  {
    id: "sample-saved-1",
    kind: "saved",
    sample: true,
    title: "A diagram that reads like a sentence",
    createdAt: at,
    updatedAt: at,
    body:
      "A diagram that reads like a sentence.\n\nWhat if the relationships in the studio were drawn left to right, so a glance could be read aloud? Source, then draft, then the decision it became. Try it with three real pieces before deciding anything.",
  },
  {
    id: "sample-saved-2",
    kind: "saved",
    sample: true,
    title: "Questions left open after today",
    createdAt: at,
    updatedAt: at,
    body:
      "Questions left open after today\n\n— Which entries deserve a page of their own?\n— Should a saved thought be able to become the first message of a chat?\n— How will we recognize a decision when we see one again?",
  },
];
