#!/usr/bin/env bash
# Publish a built copy of the site into this repo (the live GitHub Pages repo):
#   1. copy the build over the site WITHOUT touching live-owned data files,
#   2. save the previous live site as the next backup-N branch (only if something changed),
#   3. commit and push to main.
# Used by .github/workflows/publish-site.yml, and runnable by hand.
#
# Usage: BUILD_DIR=/path/to/dist/client [SOURCE_LABEL="repo@ref (sha)"] [DRY_RUN=1] scripts/publish-from-source.sh
# Run from the root of this repo, on a clean checkout of main.
set -euo pipefail

: "${BUILD_DIR:?set BUILD_DIR to the built site (dist/client of the source repo)}"
LABEL="${SOURCE_LABEL:-local build}"
DRY="${DRY_RUN:-0}"

[ -f "$BUILD_DIR/index.html" ] || { echo "No index.html in $BUILD_DIR: build the site first." >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Working tree is not clean. Commit or stash first." >&2; exit 1; }

# Files this repo owns: the scheduled jobs and the daily update write them, and sitemap.xml is hand-edited here.
# The build must never overwrite them.
KEEP=(articles.json prices.json stats.json postsyt.json postsrd.json postsig.json poststt.json postsx.json sitemap.xml)

# 1. copy, skipping live-owned files (tar works everywhere, including machines without rsync)
EXCLUDES=(); for f in "${KEEP[@]}"; do EXCLUDES+=(--exclude="./$f"); done
tar -C "$BUILD_DIR" "${EXCLUDES[@]}" -cf - . | tar -xf -
git add -A
if git diff --cached --quiet; then echo "Nothing changed: the live site already matches this build. No backup made."; exit 0; fi
git diff --cached --stat | tail -1

# 2. save the live site (the current commit, before this copy) as the next backup-N
LAST=$(git ls-remote --heads origin 'backup-*' | sed -E 's#.*refs/heads/backup-([0-9]+)$#\1#' | grep -E '^[0-9]+$' | sort -n | tail -1 || true)
BACKUP="backup-$(( ${LAST:-0} + 1 ))"
echo "Live site is $(git rev-parse --short HEAD). Next backup: $BACKUP"
if [ "$DRY" = "1" ]; then
  echo "[dry run] would save $BACKUP, commit and push. Undoing the copy."
  git reset -q --hard HEAD; git clean -fdq; exit 0
fi
git push -q origin "HEAD:refs/heads/$BACKUP"
echo "Saved live site as $BACKUP"

# 3. commit and push
git -c user.name="${GIT_AUTHOR_NAME:-github-actions[bot]}" -c user.email="${GIT_AUTHOR_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}" \
  commit -q -m "Publish $LABEL (backup: $BACKUP)"
git pull --rebase -q
git push -q
echo "Published $(git rev-parse --short HEAD). To roll back, restore the files from branch $BACKUP."
