# Claude Factory Integration

This project uses the Claude Factory framework for enhanced AI-assisted development.

## Quick Reference

### What's Available

| Location | Purpose |
|----------|---------|
| `.claude/context/current.md` | Project context (I read this every session) |
| `scenarios/` | Success criteria for features |
| `~/.claude-factory/patterns/` | Reusable code patterns |
| `~/.claude-factory/scenarios/examples/` | Scenario templates |

---

## Daily Workflow

### Starting a Session

```
"Read .claude/context/current.md and help me with [task]"
```

I'll immediately know your stack, architecture, and current focus.

### Working on a Feature

```
"I want to add [feature].

1. First check if there's a scenario in scenarios/ for it
2. If not, help me write one
3. Then implement using patterns from ~/.claude-factory/patterns/
4. Validate against the scenario when done"
```

### Quick Tasks (No Ceremony Needed)

For small fixes, just ask normally:
```
"Fix the TypeScript error in PlayerCard.tsx"
```

Use the framework for **significant features**, not one-liners.

---

## Context Management

### Update Context When Focus Changes

```bash
# Edit .claude/context/current.md to reflect current work
echo "Currently implementing: API retry logic" >> .claude/context/current.md
```

Or ask me:
```
"Update .claude/context/current.md to note we're now working on error handling"
```

### Project Context Structure

```
.claude/
├── README.md              # This file
└── context/
    └── current.md         # Project overview, stack, current focus
```

You can add more context files:
```
.claude/context/
├── current.md             # What you're working on now
├── architecture.md        # System design details
├── decisions.md           # Why certain choices were made
└── constraints.md         # Technical/business constraints
```

---

## Scenario-Driven Development

### When to Write Scenarios

✅ Write scenarios for:
- New features (before implementation)
- Complex bug fixes
- Refactoring efforts
- Anything with multiple edge cases

❌ Skip scenarios for:
- Typo fixes
- One-line changes
- Obvious bugs

### Creating a New Scenario

```
"Help me write a scenario for [feature].
Use the format from ~/.claude-factory/scenarios/examples/user-authentication.md"
```

Or copy a template:
```bash
cp ~/.claude-factory/scenarios/examples/api-integration.md scenarios/my-feature.md
# Then edit for your needs
```

### Scenario File Structure

```markdown
# Feature Name Scenario

## Scenario 1: Happy Path

**Context**: Who is the user? What are they trying to do?

**User Journey**:
1. Step one
2. Step two
3. ...

**Expected Outcomes**:
- ✅ Outcome 1
- ✅ Outcome 2

**Edge Cases**:
- What if X? → Expected behavior
- What if Y? → Expected behavior

**Validation Method**:
- How to verify this works
```

### Using Scenarios

```
"Implement the feature described in scenarios/player-comparison.md"

"Review my implementation against scenarios/player-comparison.md Scenario 2"

"What's missing from the current code based on scenarios/player-comparison.md?"
```

---

## Pattern Library

### Available Patterns

| Pattern | Location | Use For |
|---------|----------|---------|
| Exponential Backoff | `~/.claude-factory/patterns/resilience/exponential-backoff/` | API retry logic |
| Input Validation | `~/.claude-factory/patterns/security/input-validation/` | User input sanitization |

### Using Patterns

```
"Add retry logic using ~/.claude-factory/patterns/resilience/exponential-backoff/
Adapt it for NHL API calls"
```

```
"Validate search input using ~/.claude-factory/patterns/security/input-validation/
Use Zod for schema validation"
```

### Creating New Patterns

When you build something reusable:

```
"Extract the API client we just built as a pattern.
Save to ~/.claude-factory/patterns/api/nhl-client/
Include README with when/how to use it"
```

---

## Common Commands

### Feature Development
```
"Read .claude/context/current.md, then implement [feature]
following scenarios/[feature].md"
```

### Code Review
```
"Review src/services/nhlApi.ts against
~/.claude-factory/patterns/resilience/exponential-backoff/
What's missing?"
```

### Validation
```
"Does the Compare page satisfy all scenarios in
scenarios/player-comparison.md?"
```

### Pattern Application
```
"Apply ~/.claude-factory/patterns/security/input-validation/
to all user input in src/components/PlayerSearch.tsx"
```

### Context Update
```
"Update .claude/context/current.md - we finished the retry logic,
now focusing on input validation"
```

---

## Project-Specific Info

### This Project: NHL Analytics

**Stack**: React 19 + TypeScript + Vite + React Query + Recharts

**Key Services**:
- `src/services/nhlApi.ts` - Main NHL API client
- `src/services/statsService.ts` - Stats fetching
- `src/hooks/usePlayerStats.ts` - React Query hooks

**Available Scenarios**:
- `scenarios/player-comparison.md` - Player comparison feature (6 scenarios)

**Recommended Patterns**:
- Retry logic for all API calls
- Input validation for search fields
- Error boundaries for components

---

## Tips

### 1. Keep Context Current
Update `.claude/context/current.md` when switching tasks. 30 seconds now saves 5 minutes of explanation later.

### 2. Scenarios = Documentation
Scenarios serve as living documentation. Write them before implementation, reference them during code review.

### 3. Patterns Compound
Every good solution you build can become a pattern. In 3 months, you'll have a library of your best work.

### 4. Reference, Don't Repeat
Instead of explaining requirements, point at files:
- "See scenarios/player-comparison.md Scenario 3"
- "Use pattern from ~/.claude-factory/patterns/..."

### 5. Validate Often
Ask me to validate implementations against scenarios. Catches issues early.

---

## File Locations

```
Project-Specific (this repo):
├── .claude/
│   ├── README.md                    # This file
│   └── context/
│       └── current.md               # Project context
└── scenarios/
    └── player-comparison.md         # Feature scenarios

Global (shared across projects):
~/.claude-factory/
├── INDEX.md                         # Complete navigation
├── QUICK_START.md                   # 5-minute guide
├── README.md                        # Full documentation
├── patterns/                        # Reusable code patterns
│   ├── resilience/
│   │   └── exponential-backoff/     # Retry logic
│   └── security/
│       └── input-validation/        # Input sanitization
├── scenarios/
│   └── examples/                    # Scenario templates
│       ├── user-authentication.md
│       └── api-integration.md
└── templates/
    └── project-init-template.md     # New project setup
```

---

## Getting Help

```
"Show me the exponential backoff pattern"
→ I'll read ~/.claude-factory/patterns/resilience/exponential-backoff/

"What scenarios exist for this project?"
→ I'll list scenarios/

"How should I structure a new scenario?"
→ I'll reference ~/.claude-factory/scenarios/README.md

"What's the project context?"
→ I'll read .claude/context/current.md
```

---

## Example Session

```
You: "Read .claude/context/current.md and help me add input validation
     to the player search"

Me: [Reads context, understands your React + TypeScript stack]
    [References ~/.claude-factory/patterns/security/input-validation/]
    [Checks if there's a scenario for search in scenarios/]
    [Implements with Zod, following the pattern]
    [Validates against scenario edge cases]

You: "Update context that we finished validation, now doing retry logic"

Me: [Updates .claude/context/current.md]
    [Ready for next task with full context]
```

---

**Start every session with**: `"Read .claude/context/current.md"`

That's it. Everything else flows from there.
