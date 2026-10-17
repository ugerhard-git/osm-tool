# Working on this repository

Notes for Claude. The rules for everyone who changes the code are in `CONTRIBUTING.md`: how to make a change, the checks, "Code for people" and the things that must not break. How the code fits together is in `docs/how-the-code-works.md`. Read both before changing code. This file only adds what is specific to working as Claude for the owner.

## Pull requests

- **Check earlier pull requests first.** Before starting work for a new pull request, and before pushing to an existing branch, look at the state of every earlier pull request.
  - If one has been merged, start a new branch from the latest `main`. Never push to a branch whose pull request is already merged.
  - If one is still open, ask the owner whether to add to it or open a separate pull request.
- **The owner approves and merges.** Open pull requests; never merge them.
- **Plan first when asked.** When the owner asks to plan or discuss a change, agree on it before building.
- **No new tools without asking the owner.**
- Describe in each pull request what changed and how it was tested. For visual changes, include before/after screenshots.

## Before every pull request

```sh
npm run format && npm run lint && npm run build && npm test
```

Lint must be clean and all test files must pass. Add a test file or cases in `tests/` for new behaviour; how to write one is in `docs/how-the-code-works.md` under "Tests".

## Never break (details in CONTRIBUTING.md)

- Saved settings (`lookout2.…`): keep the names; clear the saved value of a removed option.
- Shared links people have already sent, including older `#` links, retired parameters and `s=cov` (now "Whole world"); the same for a saved `scope` of "cov".
- The security policy: no inline event handlers, no new outside scripts, never loosened.
- Keys: never in the repository, links or error messages.
