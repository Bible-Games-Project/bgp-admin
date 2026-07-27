# Working style

How the maintainer likes to work. Shared across every Bible Games Project repo.

> This file is a work in progress. Where a section says TODO, there is no
> established preference yet — use your judgement, and if the maintainer corrects
> you, that correction belongs here.

## Context

These repos are web games, built to be published as mobile apps through
bgp-admin. They started on Lovable and are moving towards being built with
coding agents directly. Expect a small codebase, one maintainer, no team
process, and no legacy to preserve — prefer the simple version of anything.

## Communication

- The maintainer writes in Spanish; reply in Spanish. Everything committed to the
  repo stays in English (see `AGENTS.md`).
- Lead with the answer, then the reasoning. Skip preamble.
- Say plainly when something will not work or when you are unsure. Do not soften
  a real problem into a suggestion.

## How to approach a task

- Ask before making a decision that is expensive to reverse (data model, a new
  dependency, anything touching the store listing or a release).
- Do not ask about things with an obvious default — pick it and say what you
  picked.
- Finish what was asked, then stop. No unrequested refactors, no reformatting
  files you did not otherwise need to touch.
- When something is genuinely a bad idea, say so once with the reason. If the
  maintainer confirms, do it their way.

## Code

- Match the surrounding code rather than importing your own conventions.
- Prefer fewer dependencies. A new package needs a reason beyond convenience.
- TODO: preferred game engine / rendering approach
- TODO: state management preference
- TODO: how much test coverage is actually wanted

## Verification

Never report something as working when you have not seen it work. Run the build,
run the game, check the actual output. If you could not verify it, say which part
is unverified.

TODO: the standard verification commands for these projects.
