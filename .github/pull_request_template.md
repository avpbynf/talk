<!--
Merge with "Rebase and merge" and with nothing else. "Create a merge commit" forks a history that
never forks, and "Squash and merge" collapses the branch into one commit and throws away the bodies,
which is where the reasoning for each step lives. If the rebase button is greyed out, this branch is
behind `dev`; rebase it and force-push rather than merging `dev` into it.

The base is `dev`. A request opened against `main` is a mistake to repair: `main` takes `dev` alone,
at a release, by a fast-forward, and `main-from-dev` refuses anything else.

An issue is closed from the COMMIT that closes it, on a line of its own at the foot of the body,
never from here: a closing keyword written in a request fires against the default branch, which no
ordinary request targets.
-->

## What changes

<!-- One paragraph. What the branch does to the application, not how the diff is arranged. -->

## Why it was not already like that

<!--
The cause, not the symptom. What the code did instead, and what made that the wrong thing: a
default that was never set, a stream bound to a device that moved, a figure read against the wrong
scale. "It is new" is a fine answer for a feature.
-->

## What proves it

<!--
Say which of these the claim rests on. An unticked line is not a failure, it is a scope.

- `bun run build` and `bun run test`, the tsc pass the release runs and the frontend suite.
- `bun run test:ui`, the interface suite, when a page, the sidebar or the styles moved; say which
  baselines were regenerated and that the images were looked at.
- `bun run test:rust`, or say plainly that the native side was not compiled here.
- On the machine: what was done in the running application, and what was observed rather than
  assumed. A number read off a log or a measurement carries more than a description.
-->

## What it leaves owing

<!-- Known gaps, anything a later branch has to finish, or "nothing". -->

---

- [ ] Rebased onto `dev`, so the merge is a fast-forward.
- [ ] `bun run build` and `bun run test` green locally, after the rebase and not before it.
- [ ] `bun run tauri:check` green, or the branch touches no Rust.
- [ ] `CHANGELOG.md` carries an entry under `Unreleased`, or this changes nothing anybody running
      the application would notice.
- [ ] Every place that states a fact this branch changed now states the new one: `README.md`,
      `CONTRIBUTING.md`, `CLAUDE.md`, the comments around the code, and what the interface says.
