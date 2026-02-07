# Create Pull Request

$ARGUMENTS

## Steps:
1. Determine appropriate branch name from changes
2. Stage all changes: `git add -A`
3. Create commit with conventional commit message
4. Push to origin
5. Create PR with `/opt/homebrew/bin/gh pr create`
6. Include in PR description:
   - Summary of changes
   - Testing performed
   - Documentation updates (if any)
   - Breaking changes (if any)