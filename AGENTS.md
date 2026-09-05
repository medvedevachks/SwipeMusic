# SwipeMusic

## Project

SwipeMusic is a Progressive Web Application (PWA) for building a personal music library.

The application allows users to quickly categorize music using swipe gestures.

The project is built with:

- React

- TypeScript

- Vite

- PWA

- IndexedDB

The project must remain fast, modular and offline-first.

---

# Main Goals

Priority order:

1. Stable architecture

2. Excellent UX

3. Fast performance

4. Offline support

5. Clean code

6. Easy extensibility

---

# Core Features

The application should support:

- swipe-based categorization

- local music library

- online music providers

- downloadable music providers

- multiple provider support

- offline playback

- playlists

- favorites

- history

- search

- filtering

- recommendations

---

# Architecture

Business logic must be isolated from UI.

Preferred structure:

src/

components/

pages/

hooks/

services/

providers/

storage/

types/

utils/

assets/

Every module should have a single responsibility.

Avoid duplicated logic.

---

# Music Providers

Music providers must be interchangeable.

Provider implementations should expose common interfaces.

Supported provider types:

- REST API

- downloadable file sources

- manually configured providers

Never couple provider implementation with UI.

---

# Storage

Prefer IndexedDB.

Persist:

- tracks

- metadata

- categories

- playlists

- cache

The application should continue working without internet.

---

# UI

Mobile-first.

Responsive.

Dark mode supported.

Gesture-first navigation.

Accessibility is required.

---

# Git

Repository workflow:

main

↓

develop

↓

feature/*

bugfix/*

hotfix/*

Never develop directly on main.

Always work inside feature branches.

Use Conventional Commits.

---

# Quality

Before considering a task complete:

- TypeScript passes

- Build succeeds

- Lint succeeds

- Existing functionality preserved

---

# Documentation

Update documentation whenever architecture or public behaviour changes.

Keep README current.

Document important decisions.

---

# AI Agent Behaviour

Before coding:

- understand existing implementation

- minimize changes

- reuse existing modules

- avoid rewriting working code

Prefer incremental improvements.

Repository stability is more important than large refactoring.

If a change affects architecture or many files, explain the implementation plan before making changes.