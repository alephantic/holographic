# Holographic

**A Composition Studio by Ainsley Aleph and Tyldah Kerning.**

Holographic is a long-term creative software project: a collective environment where written, visual, design, musical, mathematical, and scientific or experimental forms of composition can happen under one roof and inform one another.

We want it to be both a place to make things and a home for the ongoing work behind them: manuscripts, images, music, research, designs, sources, experiments, and the relationships among them.

Our starting point is small and concrete: **one beautiful interface with two ways to begin—Chat or Save.**

> **Project status:** Early development. This README describes the larger vision and our first build target. The first interface (Chat or Save) is implemented in this repository; later tools and integrations remain possibilities to explore.

## Running the first interface

The first build is a small web app: a React + TypeScript client (Vite) and a Node server (Hono) that holds the model credential. Saved entries live in the browser's local storage for now; the server exists only so a model key never reaches the client.

```bash
npm install
cp .env.example .env     # optional: add OPENAI_API_KEY or ANTHROPIC_API_KEY to enable Chat
npm run dev              # client on http://localhost:5173, API on :8787
```

Without a key, the interface says so and Save still works. Nothing is ever faked: Chat only answers when a real model is connected.

On a public deployment, also set `HOLOGRAPHIC_ACCESS_KEY`. Chat requests must then carry that key (the interface asks for it once and remembers it in the browser), so only people you share it with can spend the model credential. Per-request limits cap the size of any single call, and a spending limit on the model provider's side is the only hard ceiling, so set one there too.

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the client and the API server together, with reload |
| `npm run check` | Typecheck, unit tests, and a production build |
| `npm run test:e2e` | Browser tests (uses the Chrome already installed on the machine) |
| `npm run build` then `npm start` | Serve the built client and API from one process |
| `node scripts/screenshots.mjs` | Capture the main screens at desktop and mobile widths |

Layout: `src/` is the client, `server/` the API, `shared/` the wire protocol both sides use, `api/` the Vercel entry point for the same API (with `vercel.json`), and `e2e/` the browser tests. Saved entries are a single versioned document (`src/lib/types.ts`) so the shape can grow to hold pages of *The Entrance Way* later. Sample entries are built in, labeled as samples, and never stored.

## What we mean by a Composition Studio

Composition means arranging things in relation to one another. Those things might be words, sounds, colors, spaces, quantities, or observations. The forms differ, but working in one can change how we understand another.

A novel might borrow its structure from music. A diagram might reveal a mathematical relationship. A research question might lead to a visual experiment, which might suggest a new way to design an interface. Holographic should make room for those exchanges while respecting the particular tools and methods each form requires.

Over time, the studio could become a connected collection of creative tools, demos, and experiments. Some might be substantial workspaces; others might be small, strange things made to answer a single question.

The work around an artifact belongs here, too. We want somewhere to return to unfinished ideas, see what we have tried, recognize what has become a decision, and find the questions we have left open. A finished piece and the work that made it possible should be able to live in the same environment.

## Software as a theme park

We like the idea of **software as a theme park**: a place with different things to discover, each with its own character, held together by a coherent world.

For Holographic, that suggests tools that invite experimentation, interfaces with a strong visual identity, and enough continuity that moving between activities feels natural. Typography, color, layout, motion, and the way an interaction responds should all help make the studio a pleasure to inhabit.

Kid Pix is a touchstone for the spirit we want to preserve: curiosity, play, and the pleasure of trying something just to see what happens. We want that sense of possibility alongside the depth needed for sustained creative work.

Beauty is part of the project's purpose. So are clear navigation, comfortable reading and writing, and room to concentrate. There should be places to wander and places to settle in.

## Where we are starting

### One interface, two ways to begin

The first experiment is a visually compelling interface inspired by the conversational flow of ChatGPT. It should feel inviting before anything has been entered and remain comfortable as the work grows.

The initial scope centers on two actions:

| Start with | Intended behavior |
| --- | --- |
| **Chat** | Write a message and receive a response from an AI model when an API is connected. |
| **Save** | Write a prompt or other piece of text, save it as an entry, and reopen it later. |

The interface may initially be tested **without an API connection**. Saving and reopening writing should be useful on their own. Chat behavior can be tested once a model connection is available.

The first experiment should let us answer three practical questions:

- Can we save a written entry?
- Can we reopen it and confirm that its contents have been preserved?
- When an API is connected, can we send a message and receive a response?

Alongside those checks, we want to spend time using the interface and judge the design itself: the typography, spacing, clarity of the two actions, and experience of reading and writing.

This is the first experiment within Holographic. It gives us a manageable starting point for the wider studio and a way to learn through actual use.

## Directions we may explore

The first interface can help us decide what deserves to be built next. These are possible directions, with their details and order still open.

### Written work as material

Saved entries could provide a foundation for adding pages from *The Entrance Way*, a work within Gibsey. We could then test how that material is stored, reopened, and accessed as part of a larger body of writing.

Beginning with a single saved entry gives us something concrete to understand before deciding how a manuscript or interconnected collection should work.

### Project memory

A later memory system could help us retrieve relevant material, trace ideas back to sources, distinguish tentative thoughts from decisions, and resume work without reconstructing its entire history.

Its behavior and technical approach still need to be designed and tested. The first interface should give us real material and real questions to work with when that exploration begins.

### Connections across forms

The studio could eventually bring manuscripts, visual work, music, research, designs, and demos into relation with one another. We want to discover which connections actually help us compose: following a source into a draft, comparing a musical structure with a written one, or returning to the experiment behind a design choice.

### A visual tool with a sense of play

Tyldah has proposed an in-house visual tool that combines some of Photoshop's possibilities with the playful spirit of Kid Pix.

It is an exciting future idea. Its scope, behavior, and place within the studio remain open.

### Further experiments

Holographic may grow through specialized tools, exploratory demos, and perhaps even hardware. Those possibilities can take shape as the work gives us reasons to pursue them.

## Ainsley, Tyldah, and Gibsey

**Ainsley Aleph** and **Tyldah Kerning** are Holographic's developers and creative collaborators. Tyldah is leading the graphic design side, helping shape the studio's visual character and the experience of using it.

Holographic also belongs to **Gibsey**, an interconnected fictional world and body of writing. Within that fiction, Ainsley is an entrepreneur and developer who, after **Malt Gibsey has unexpectedly disappeared**, is attempting to transform the writings and artifacts which Malt left behind into a working technological system called Holographic.

Ainsley is also the creative persona through which the real project is being developed. That leaves the fictional and real versions of Holographic in an ongoing conversation: the fiction supplies materials and possibilities; building the software may suggest new ones.

You do not need to know Gibsey to understand the project. The relationship between the two can stay playful and open as both develop.

## Open questions

Several foundational choices remain to be made:

- **Technical foundation:** Which stack and storage approach best serve the first interface and leave room for the studio to grow?
- **Model access:** Which API connection should we test first, and how should it fit into the writing experience?
- **Project memory:** What should be retrieved, how should sources remain visible, and how will we tell whether the system helps us resume work accurately?
- **Existing tools:** Could Obsidian, which we already use, become part of Holographic? No integration has been decided.
- **The shape of the studio:** Which activities belong together, which need their own spaces, and what should connect them?

We expect these questions to become clearer through making things, using what we make, and paying attention to what the work asks for next.

For now, the entrance is a place to write something—and a reason to come back to it.
