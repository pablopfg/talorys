# Branch protection

`main` and `develop` are protected by GitHub rulesets stored as JSON in
[`.github/rulesets/`](../.github/rulesets). The files are the source of truth;
GitHub does not read them automatically, so they have to be applied once (and
again after each change).

## Workflow

- Work happens on feature branches that open pull requests into `develop`.
- Releases are pull requests from `develop` into `main`. Urgent fixes may come
  from a `hotfix/*` branch.
- After a `hotfix/*` lands in `main`, open a pull request from `main` into
  `develop` so `develop` gets the fix too.

## Rules

| Rule | `main` | `develop` |
| --- | --- | --- |
| Cannot be deleted | yes | yes |
| No force pushes | yes | yes |
| Changes only through pull requests | yes | yes |
| Review conversations must be resolved | yes | yes |
| CI job `test` must pass | yes | yes |
| Source must be `develop` or `hotfix/*` (`source-branch` check) | yes | no |

No approving review is required, because a single maintainer cannot approve
their own pull request. Repository admins can bypass the rules, but only when
merging a pull request, never by pushing directly.

Neither branch has to be up to date with its base before merging. Bringing
`main` into `develop` from a release pull request (the **Update branch**
button) would be a direct push to `develop`, which its rules block, so on
`main` that requirement would leave every release after the first stuck.

[`.github/CODEOWNERS`](../.github/CODEOWNERS) requests a review from the owner
on every pull request.

## Applying the rulesets

With the [GitHub CLI](https://cli.github.com/) logged in as a repository admin:

```bash
scripts/apply-rulesets.sh            # current repository
scripts/apply-rulesets.sh owner/repo # another repository
```

The script creates each ruleset, or updates the one with the same name.

Without the CLI: **Settings → Rules → Rulesets → New ruleset → Import a
ruleset**, and pick each JSON file.

Rulesets on private repositories need a paid GitHub plan; on public
repositories they are free.

## CI

The CI workflow runs once for each commit pushed to a pull request, and not
again when the pull request is merged: the rules above mean `main` and
`develop` only change through pull requests, so a run after the merge would
repeat tests on code already tested. Each run tests the pull request merged
into its base as it was when the commit was pushed. A new commit cancels the run still going for the same pull request.

Lint, typecheck, build and the package test run in one job; the unit tests
(the agent suite split in three) and the browser tests run in parallel jobs.
The `test` job passes only when all of them pass, and it is the one check the
rules require.

## A pull request waits forever for `test`

The required `test` check only exists once the CI workflow has run on the pull
request's latest commit. A pull request opened while Actions was disabled, or
before the workflow existed on its branch, never gets that run. Start one with
**Actions → CI → Run workflow** on the pull request's branch, or bring
`develop` into the branch (the **Update branch** button) so a new commit
triggers CI.
