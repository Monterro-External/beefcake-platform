# Gitflow

`develop` is the default branch and collects work for the next release.
`main` holds released code. Use pull requests and **Create a merge commit**
for every integration; preserving ancestry matters when branches merge into
both `main` and `develop`.

| Branch | Start from | Merge into |
|---|---|---|
| `feature/<topic>` | `develop` | `develop` |
| `release/<version>` | `develop` | `main`, then `develop` |
| `hotfix/<version>` | `main` | `main`, then `develop` and any active release |

Codex uses the same flow with `codex/feature/`, `codex/release/` and
`codex/hotfix/` prefixes. Documentation, refactoring and ordinary bug fixes use
feature branches too. No Gitflow extension is required; standard Git works.

## Daily work

```bash
git fetch origin
git switch -c feature/member-search origin/develop
# Make and commit changes.
git push -u origin HEAD
gh pr create --base develop
```

Wait for all CI jobs, review the changes, then merge the PR with a merge commit.
Delete the feature branch after merging. Do not push directly to `main` or
`develop`, force-push either branch, or rewrite a shared release/hotfix branch.

## Release

1. Fetch `origin` and create `release/0.2.0` from `origin/develop` (substitute
   the intended version). Keep new features on `develop`; only release fixes
   and metadata changes belong on this branch.
2. Run `npm version 0.2.0 --no-git-tag-version`; commit both `package.json` and
   `package-lock.json`. Push the branch and open a PR targeting `main`.
3. After CI passes and the PR is reviewed, merge with a merge commit. Record
   the PR's exact merge commit SHA, fetch `origin`, and tag that commit:

   ```bash
   git fetch origin
   git tag -a v0.2.0 <merge-commit-sha> -m "Release 0.2.0"
   git push origin v0.2.0
   ```

4. Open a second PR from the same release branch to `develop`. Merge with a
   merge commit after checks and review. Resolve conflicts through a temporary
   branch if necessary: start a feature branch from
   `origin/develop`, merge the release branch into it, resolve, then PR that
   branch into `develop`. This avoids adding later development work to the
   release branch.
5. Delete the release branch only after both integrations are complete.

Tagging identifies the release; deployment remains the existing process in
the README. This workflow does not add automatic production deployment.

## Hotfix

1. Fetch `origin` and create `hotfix/0.2.1` from `origin/main` (substitute the
   next patch version). Fix the production issue and update the version using
   `npm version 0.2.1 --no-git-tag-version`; commit the manifest and lockfile.
2. Push and open a PR to `main`. After CI and review, merge with a merge commit
   and tag the exact merge commit as `v0.2.1`, as in the release procedure.
3. Open a PR from the hotfix branch to `develop`, and to the active release
   branch if one exists. Preserve the upcoming version when resolving version
   conflicts. For conflicts, use a temporary branch from the target branch and
   merge the hotfix into it, then PR the result back to that target.
4. Delete the hotfix branch only after all integrations are complete.

## CI and repository settings

CI runs for every PR and for pushes to `main`, `develop`, release and hotfix
branches, including their Codex equivalents. Every PR must pass:

- **Lint, typecheck, unit tests** (UTC)
- **Seed at full scale** (database rebuild and production build)
- **End-to-end flows**

The repository uses `develop` as its default branch and merge commits as its
only PR merge method. Automatic branch deletion stays off: release and hotfix
branches need more than one integration before removal.

At setup, GitHub returned HTTP 403 for branch protection/rulesets because the
current plan does not support them for this private repository. Until that
changes, PRs and successful checks are a team convention, not a server-enforced
restriction. Once available, protect both `main` and `develop`: require PRs,
the three checks above and resolved conversations; disallow force pushes and
deletion. Allow merge commits (do not require linear history).

Based on [the original Gitflow model](https://nvie.com/posts/a-successful-git-branching-model/),
using `main` in place of `master`.
