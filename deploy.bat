@echo off
echo === Cleaning up junk files ===
cd /d "C:\Users\Oz\Desktop\telegrambot PRD"
if exist "claude-daily-review-*.html" del /q claude-daily-review-*.html
if exist "getset.mjs" del /q getset.mjs
if exist "getset2.mjs" del /q getset2.mjs
if exist "qa_plan.md" del /q qa_plan.md
if exist "scanning_guide.md" del /q scanning_guide.md
if exist "architecture_specs.md" del /q architecture_specs.md

echo === Removing git lock files ===
if exist ".git\HEAD.lock" del /q .git\HEAD.lock
if exist ".git\index.lock" del /q .git\index.lock

echo === Git push ===
git config user.email "oz@sepros.co.il"
git config user.name "Oz"
git add -A
git commit -m "fix: scan auth, secrets masking, affiliateLink guard, truncation repairs, rating label, gitignore cleanup"
git push

echo === Done! ===
pause
