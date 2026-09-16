<#
    Move the Windows pagefile from C: to D:  (docs/18 Phase 0.1)

    Why: C: is the system drive and was repeatedly running out of space, which
    docs/13 identifies as the real cause of the "low memory" process kills.
    The pagefile is allocated ~12.9 GB there while never exceeding ~1.3 GB of
    actual use, so it is the single largest reclaimable item on the drive.

    MUST be run as Administrator. Takes effect after a reboot.

        Right-click Start -> Terminal (Admin), then:
        powershell -ExecutionPolicy Bypass -File D:\amatic-main\scripts\move-pagefile-to-d.ps1

    Order matters: D: is created BEFORE C: is removed, so the machine is never
    left with no pagefile at all if a step fails.
#>

$ErrorActionPreference = "Stop"

# --- safety checks ---------------------------------------------------------
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "This script must run as Administrator." -ForegroundColor Red
    Write-Host "Right-click Start -> Terminal (Admin), then run it again."
    exit 1
}

$dDrive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='D:'" -ErrorAction SilentlyContinue
if (-not $dDrive) { Write-Host "D: not found. Aborting." -ForegroundColor Red; exit 1 }
$freeGB = [math]::Round($dDrive.FreeSpace / 1GB, 1)
if ($freeGB -lt 20) {
    Write-Host "D: has only $freeGB GB free; want 20+ for a pagefile. Aborting." -ForegroundColor Red
    exit 1
}

Write-Host "`nBefore:" -ForegroundColor Cyan
Get-CimInstance Win32_PageFileSetting | Select-Object Name, InitialSize, MaximumSize | Format-Table -AutoSize
Get-PSDrive -PSProvider FileSystem |
    Where-Object { $_.Name -in 'C', 'D' } |
    Select-Object Name, @{n = 'FreeGB'; e = { [math]::Round($_.Free / 1GB, 1) } } | Format-Table -AutoSize

# --- apply -----------------------------------------------------------------
# Turn off "automatically manage" so explicit settings are honoured.
$cs = Get-CimInstance Win32_ComputerSystem
if ($cs.AutomaticManagedPagefile) {
    Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $false }
    Write-Host "disabled automatic pagefile management"
}

# 1. Create the D: pagefile first (0/0 = system managed size).
$existingD = Get-CimInstance Win32_PageFileSetting -Filter "Name='D:\\\\pagefile.sys'" -ErrorAction SilentlyContinue
if ($existingD) {
    Write-Host "D:\pagefile.sys already configured"
} else {
    New-CimInstance -ClassName Win32_PageFileSetting `
        -Property @{ Name = 'D:\pagefile.sys'; InitialSize = 0; MaximumSize = 0 } | Out-Null
    Write-Host "created D:\pagefile.sys (system managed)" -ForegroundColor Green
}

# 2. Only now remove the C: pagefile.
$existingC = Get-CimInstance Win32_PageFileSetting -Filter "Name='c:\\\\pagefile.sys'" -ErrorAction SilentlyContinue
if ($existingC) {
    Remove-CimInstance -InputObject $existingC
    Write-Host "removed C:\pagefile.sys" -ForegroundColor Green
} else {
    Write-Host "no C: pagefile configured"
}

Write-Host "`nAfter (takes effect on reboot):" -ForegroundColor Cyan
Get-CimInstance Win32_PageFileSetting | Select-Object Name, InitialSize, MaximumSize | Format-Table -AutoSize

Write-Host "Reboot to apply. C:\pagefile.sys is deleted during shutdown," -ForegroundColor Yellow
Write-Host "so the ~12.9 GB comes back only after the restart completes.`n" -ForegroundColor Yellow
Write-Host "Restart now with:  Restart-Computer"
