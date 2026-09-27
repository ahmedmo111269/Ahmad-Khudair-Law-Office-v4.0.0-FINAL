# ADR-015: Indexed Prefix Search

## Context
Main-list and search operations must not load the entire operational database into memory.

## Decision
Use normalized searchable fields with IndexedDB prefix ranges (`IDBKeyRange.bound(prefix, prefix + U+FFFF)`) and bounded result sets. Structured identifiers use their dedicated indexes.

## Consequences
Search is fast and memory-bounded for common prefix queries, while arbitrary full-text search remains a future capability if real query patterns justify a local search index.
