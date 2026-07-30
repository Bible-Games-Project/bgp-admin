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

## The user

The person giving instructions is **not a programmer**. They know what they want
the app to do, but they cannot write code, debug errors, or navigate technical
details.

- Be patient and clear. Explain technical constraints in plain language.
- Do not ask them to run terminal commands, edit files, or check logs unless
  there is absolutely no other way.
- When something fails, fix it yourself. Do not tell them how to fix it.
- Confirm understanding by restating the request in your own words before
  starting.

## The development cycle (Lovable-style)

This project follows a tight ask → build → preview → validate loop:

1. **Ask** — The user tells you what they want (in Spanish, in natural language).
2. **Implement** — You write the code, make it work locally if possible.
3. **Push** — Commit and push to `main`. Do not ask for permission to push;
   pushing is how previews happen. Use `[skip ci]` only when the change is
   documentation or agent-only and has no visible effect.
4. **Preview** — The GitHub workflow deploys to Cloudflare Pages automatically.
   Wait for the deploy to finish (check the Actions tab).
5. **Validate** — Tell the user the preview URL is ready and ask them to check
   it. Be specific about what changed and what to look for.
6. **Iterate** — If the user says it is not right, go back to step 2. If they
   confirm it is good, you are done.

Never stop after step 2. The work is not finished until the user has seen the
preview and confirmed it.

## Communication

- The maintainer writes in Spanish; reply in Spanish. Everything committed to the
  repo stays in English (see `AGENTS.md`).
- Lead with the answer, then the reasoning. Skip preamble.
- Say plainly when something will not work or when you are unsure. Do not soften
  a real problem into a suggestion.
- After pushing, always provide the preview URL so the user can click and see.

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

To verify the build locally:
```bash
bun install && bun run build
```

To preview the built output:
```bash
bun run preview
```

TODO: the standard verification commands for these projects.
