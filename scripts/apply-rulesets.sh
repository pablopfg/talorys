#!/usr/bin/env bash
# Creates or updates the GitHub rulesets in .github/rulesets/ on a repository.
# Requires the GitHub CLI (gh) logged in as a repository admin, and Node.js.
# Usage: scripts/apply-rulesets.sh [owner/repo]
set -euo pipefail

repo="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
dir="$(cd "$(dirname "$0")/../.github/rulesets" && pwd)"

for file in "$dir"/*.json; do
  name="$(node -p "require(process.argv[1]).name" "$file")"
  id="$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id")"
  if [ -n "$id" ]; then
    gh api --method PUT "repos/$repo/rulesets/$id" --input "$file" --jq '"updated: \(.name) (#\(.id))"'
  else
    gh api --method POST "repos/$repo/rulesets" --input "$file" --jq '"created: \(.name) (#\(.id))"'
  fi
done
