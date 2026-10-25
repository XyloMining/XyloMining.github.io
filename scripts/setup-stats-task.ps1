# One-time setup for Windows. Clones the site repo, installs what the TikTok stats fetch needs, and schedules it
# to run every 6 hours while your computer is on (missed runs happen as soon as it is back on).
# Each run: pull, fetch TikTok stats, rebuild stats.json, commit and push. GitHub Pages then shows the new numbers.
#
# Run in PowerShell:
#   powershell -ExecutionPolicy Bypass -File setup-stats-task.ps1
# Remove later:
#   Unregister-ScheduledTask -TaskName "XyloMining TikTok stats" -Confirm:$false
$ErrorActionPreference = "Stop"
$Repo   = "https://github.com/XyloMining/XyloMining.github.io.git"
$Dir    = Join-Path $env:USERPROFILE "XyloMiningStats"
$Handle = "xylo_mining"
$Task   = "XyloMining TikTok stats"

function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User") }
function Works($cmd, $arg) { try { & $cmd $arg *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false } }
function Need($cmd, $arg, $wingetId) {
  if (Works $cmd $arg) { return }
  Write-Host "$cmd not found, installing $wingetId with winget..."
  winget install --id $wingetId -e --accept-package-agreements --accept-source-agreements
  Refresh-Path
  if (-not (Works $cmd $arg)) { throw "$cmd was installed but is not available yet. Close this window, open a new PowerShell and run this script again." }
}
Need "git"    "--version" "Git.Git"
Need "node"   "--version" "OpenJS.NodeJS.LTS"
Need "python" "--version" "Python.Python.3.12"

if (-not (Test-Path (Join-Path $Dir ".git"))) { git clone $Repo $Dir } else { git -C $Dir pull --rebase }
Set-Location $Dir
# Keep local files out of commits
Add-Content -Path ".git\info\exclude" -Value "run-stats.local.ps1", "stats-run.log", "data/"

python -m pip install --upgrade TikTokApi
python -m playwright install chromium

$tok = Read-Host "Paste your TikTok msToken (cookie from tiktok.com), or press Enter to skip"
if ($tok) { [Environment]::SetEnvironmentVariable("ms_token", $tok.Trim(), "User"); $env:ms_token = $tok.Trim() }

$Runner = Join-Path $Dir "run-stats.local.ps1"
@"
`$ErrorActionPreference = "Continue"
Set-Location "$Dir"
Start-Transcript -Path "$Dir\stats-run.log" -Force | Out-Null
git pull --rebase -q
python scripts\tiktok_stats.py $Handle --count 30 --headed
node scripts\fetch-stats.mjs
git add stats.json
git diff --cached --quiet
if (`$LASTEXITCODE -ne 0) { git commit -q -m "Refresh stats (local)"; git pull --rebase -q; git push -q }
Stop-Transcript | Out-Null
"@ | Set-Content -Path $Runner -Encoding UTF8

$action   = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Runner`""
$trigger  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 6) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Scheduled '$Task' every 6 hours (first run in 5 minutes)."

Write-Host "Running it once now so Git can ask you to sign in to GitHub if needed..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Runner
Write-Host "Done. Check $Dir\stats-run.log for the result."
