---
inclusion: auto
name: specimen-bugfix
description: How to write a Kiro bugfix spec around a SPECIMEN JAR repro block. Use when filing or editing a bugfix spec for a rattled or cracked jar.
---

# SPECIMEN JAR bugfix specs

A bugfix spec filed from a jar lives at `.kiro/specs/<slug>/bugfix.md`. File one spec per change signature. Every jar that shares the signature goes into that one spec.

## The repro block

The `specimen` CLI writes the repro block. The agent never does.

- It sits between the lines `<!-- specimen:repro:start -->` and `<!-- specimen:repro:end -->`.
- It lists the accession id of every jar with the same change signature (ids look like `SPC-0004`), the recorded call, the recorded response, the replayed response, and the field-level diff table.
- Copy it byte for byte, markers included. Never edit, reorder or summarise it.
- Never invent a value that is not in the repro block.

## Required layout, in this order

```
# Bugfix Requirements Document

## Introduction

<repro block>

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN <call and condition> THEN the system <what the replay returned>

### Expected Behavior (Correct)

2.1 WHEN <same condition> THEN the system SHALL <restore the jarred reference>

### Unchanged Behavior (Regression Prevention)

3.1 WHEN <condition> THEN the system SHALL CONTINUE TO <preserved behavior> (SPC-0001)
```

## Section rules

- **Introduction**: two or three sentences. Name the server, the tool, the verdict state (RATTLED or CRACKED) and the accession ids. Put the repro block right after it, under the same heading.
- **Current Behavior**: numbered `1.n` lines. Describe only what the diff table shows.
- **Expected Behavior**: numbered `2.n` lines. Each line names the jarred reference it restores:
  - Rattled field: the JSON pointer and its recorded value.
  - Dropped list item: the removed ids.
  - Cracked jar: the missing tool name.
- **Unchanged Behavior**: numbered `3.n` lines. Cite the PRESERVED jars of the same tool by accession id. If the repro block lists none, say so in one line and do not make any up.

## Do not

- Do not claim the server is safe. A clean replay means "clean on the recorded set" only.
- Do not propose code changes. Kiro's Bug Fix workflow decides the fix.
- Do not write outside `.kiro/specs/<slug>/bugfix.md`.
