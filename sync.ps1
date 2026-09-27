while ($true) {
    $changes = git status --porcelain
    if ($changes) {
        git add .
        git commit -m "Auto-sync update: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        git push origin main
        Write-Host "Changes pushed to GitHub successfully!" -ForegroundColor Green
    }
    Start-Sleep -Seconds 5
}