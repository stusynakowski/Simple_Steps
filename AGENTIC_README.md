Agent-Guardrailed Development Framework (Python + pytest)

This repository defines a phase-based development workflow designed to work with
AI coding agents (Copilot, Claude Code, Cursor, etc.) while remaining agent-agnostic.

The goal of this framework is to:
- reduce repeated context
- enforce clear development stages
- prevent agents from editing the wrong files
- produce persistent, auditable artifacts
- make progress verifiable via tests and CI

This is not application documentation.
This file describes how to use the development framework itself.

----------------------------------------------------------------

CORE PRINCIPLES

1. Phased development
   Work proceeds in explicit phases:
   IDEA -> SPEC -> TESTS -> IMPLEMENTATION

   Each phase has a clearly defined purpose and output.

2. Hard edit boundaries
   In each phase, the agent is only allowed to edit specific directories.
   Violations are blocked locally and in CI using guardrail scripts.

3. Requirements as contracts
   Specifications define stable requirement IDs (REQ-*).
   Tests reference those IDs.
   Code implements those IDs.
   Nothing is considered complete unless it is traceable.

4. Minimal context by default
   Agents read a single entry point: docs/context.md.
   Additional context must be explicitly linked, not assumed.

----------------------------------------------------------------

REPOSITORY STRUCTURE

docs/
  introduction.md   Application overview (what is being built)
  context.md        Agent entry point and current phase
  spec/             Formal requirements (REQ IDs live here)
  testplan/         Mapping from REQ IDs to tests
  adr/              Architecture Decision Records (design rationale)

prompts/
  Reusable agent prompts for each phase

src/
  Application code (implementation only)

tests/
  pytest tests that reference REQ IDs

scripts/
  Guardrails that enforce phase rules

.github/
  CI configuration and optional agent instructions

----------------------------------------------------------------

DEVELOPMENT PHASES

PHASE 1: IDEA
Purpose:
  Describe the problem, users, and constraints.

Allowed edits:
  - docs/introduction.md
  - docs/context.md

Output:
  - Clear problem statement
  - Use cases and non-goals
  - Success criteria

No specs, no tests, no code.

----------------

PHASE 2: SPEC
Purpose:
  Define what must be built, precisely and unambiguously.

Allowed edits:
  - docs/spec/**
  - docs/adr/**
  - docs/context.md

Output:
  - Requirements with stable IDs (REQ-CORE-001, etc.)
  - Interfaces and acceptance criteria
  - Edge cases and error handling

Specs should be detailed enough that a contractor could implement them.

----------------

PHASE 3: TESTS
Purpose:
  Define how correctness is measured.

Allowed edits:
  - tests/**
  - docs/testplan/**
  - docs/context.md

Output:
  - pytest test cases
  - Explicit mapping from REQ IDs to TEST IDs

Every requirement must be covered by at least one test.

----------------

PHASE 4: IMPLEMENTATION
Purpose:
  Write code until tests pass.

Allowed edits:
  - src/**
  - docs/context.md

Output:
  - Minimal implementation that satisfies specs
  - Passing test suite

Implementation is iterative but bounded.
Stop when tests pass or when the iteration limit is reached.

----------------------------------------------------------------

REQUIREMENT ID (REQ ID) CONVENTION

All requirements use the following format:

  REQ-<DOMAIN>-<NUMBER>

Examples:
  REQ-CORE-001   Core functionality
  REQ-API-002    Public API behavior
  REQ-ERR-001    Error handling
  REQ-PERF-001   Performance constraints

Rules:
  - IDs are never renumbered or reused
  - Deprecated requirements remain documented
  - Tests must reference REQ IDs explicitly
  - Code should reference REQ IDs in docstrings or comments

----------------------------------------------------------------

GUARDRAIL ENFORCEMENT

Local enforcement:
  Run the guardrails before committing:

    PHASE=spec ./scripts/verify_phase.sh

  If files outside the allowed directories were modified, the command fails.

CI enforcement:
  Continuous integration runs the test suite automatically.
  Phase guardrails can optionally be enforced in CI using branch naming rules.

Agents cannot silently violate the workflow.

----------------------------------------------------------------

USING THIS FRAMEWORK WITH AI AGENTS

1. Set the current phase in docs/context.md
2. Choose the corresponding prompt from the prompts/ directory
3. Start the agent session with:
   - Read docs/context.md
   - Only edit files allowed for the current phase
4. After changes, run:
   - PHASE=<phase> ./scripts/verify_phase.sh
   - pytest

If guardrails or tests fail, the work is not accepted.

----------------------------------------------------------------

WHAT THIS FRAMEWORK DOES NOT DO

- It does not auto-generate specs or tests for you
- It does not assume a specific AI agent or editor
- It does not optimize for speed over correctness
- It does not remove the developer from decision-making

This framework exists to amplify developer judgment,
not replace it.

----------------------------------------------------------------

EXPECTED MINDSET

Treat specifications as contracts.
Treat tests as law.
Treat agents as powerful but untrusted collaborators.

If something feels ambiguous, fix the specification,
not the prompt.

----------------------------------------------------------------

END OF DOCUMENT
