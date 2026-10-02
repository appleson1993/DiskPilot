$ErrorActionPreference = 'Stop'
$testRoot = Join-Path $PSScriptRoot '..\..\diskpilot-qa'
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
Start-Transcript -Path (Join-Path $testRoot 'native-test.log') -Force
$vhdPath = Join-Path $testRoot 'diskpilot-test.vhdx'
$attached = $false
function Check($condition, $message) { if (-not $condition) { throw ('FAILED: ' + $message) }; Write-Output ('PASS: ' + $message) }
try {
    . (Join-Path $PSScriptRoot '..\native\disk.ps1')
    if (Test-Path -LiteralPath $vhdPath) { throw 'Test VHD already exists; refusing overwrite' }
    Run-Diskpart @(('create vdisk file="' + $vhdPath + '" maximum=1024 type=expandable'),('select vdisk file="' + $vhdPath + '"'),'attach vdisk')
    $attached = $true
    $diskImage = Get-DiskImage -ImagePath $vhdPath
    $disk = $diskImage | Get-Disk
    Check ($disk.Number -ne 0 -and $disk.Size -eq 1GB -and $disk.BusType -eq 'File Backed Virtual') 'Only isolated file-backed test disk selected'
    $disk | Initialize-Disk -PartitionStyle MBR
    $dn = $disk.Number
    $gap = @(Get-Gaps (Get-Disk -Number $dn))[0]
    $used = @(Get-Volume | Where-Object DriveLetter | ForEach-Object { [string]$_.DriveLetter })
    $letter = @('T','U','V','W','X','Y','Z') | Where-Object { $_ -notin $used } | Select-Object -First 1
    $q = [pscustomobject]@{ kind='create'; diskNumber=$dn; offset=$gap.offset; size=256MB; letter=$letter; fileSystem='NTFS'; label='DiskPilot QA' }
    $plan = Make-Plan $q
    $null = Apply-Plan $plan
    $part = Get-Partition -DriveLetter $letter
    Check ($part.Size -eq 256MB) 'Create 256 MiB NTFS partition'
    $dataPath = $letter + ':\preserve-me.txt'
    'DiskPilot preserves existing data during resize.' | Set-Content -LiteralPath $dataPath
    $hash = (Get-FileHash -LiteralPath $dataPath).Hash
    $q = [pscustomobject]@{ kind='resize'; diskNumber=$dn; partitionNumber=$part.PartitionNumber; size=512MB }
    $plan = Make-Plan $q; $null = Apply-Plan $plan
    Check ((Get-Partition -DriveLetter $letter).Size -eq 512MB) 'Extend partition to 512 MiB'
    Check ((Get-FileHash -LiteralPath $dataPath).Hash -eq $hash) 'Data intact after extension'
    $q.size = 384MB
    $plan = Make-Plan $q; $null = Apply-Plan $plan
    Check ((Get-Partition -DriveLetter $letter).Size -eq 384MB) 'Shrink partition to 384 MiB'
    Check ((Get-FileHash -LiteralPath $dataPath).Hash -eq $hash) 'Data intact after shrinking'
    $bad = Make-Plan ([pscustomobject]@{ kind='rename'; diskNumber=$dn; partitionNumber=$part.PartitionNumber; label='Renamed' })
    $bad.fingerprint = 'stale'
    $blocked=$false; try { $null=Apply-Plan $bad } catch { $blocked=$_.Exception.Message -match '配置已改變' }
    Check $blocked 'Stale disk layout is blocked'
    $plan = Make-Plan ([pscustomobject]@{ kind='rename'; diskNumber=$dn; partitionNumber=$part.PartitionNumber; label='Renamed' })
    $null = Apply-Plan $plan
    Check ((Get-Volume -DriveLetter $letter).FileSystemLabel -eq 'Renamed') 'Rename volume'
    $plan = Make-Plan ([pscustomobject]@{ kind='format'; diskNumber=$dn; partitionNumber=$part.PartitionNumber; label='Fresh'; fileSystem='NTFS' })
    Check $plan.destructive 'Format plan marked destructive'
    $null = Apply-Plan $plan
    Check ((Get-Volume -DriveLetter $letter).FileSystemLabel -eq 'Fresh' -and -not (Test-Path -LiteralPath $dataPath)) 'Format test volume'
    $plan = Make-Plan ([pscustomobject]@{ kind='delete'; diskNumber=$dn; partitionNumber=$part.PartitionNumber })
    $null = Apply-Plan $plan
    Check (@(Get-Partition -DiskNumber $dn).Count -eq 0) 'Delete test volume'
    $c = Get-Partition -DriveLetter C
    foreach ($kind in @('delete','format')) {
        $blocked=$false
        try { $null=Make-Plan ([pscustomobject]@{ kind=$kind; diskNumber=$c.DiskNumber; partitionNumber=$c.PartitionNumber; fileSystem='NTFS'; label='blocked' }) } catch { $blocked=$_.Exception.Message -match '不能刪除或格式化' }
        Check $blocked ('System volume ' + $kind + ' blocked during preflight')
    }
    $limits = Get-Limits ([pscustomobject]@{diskNumber=$c.DiskNumber;partitionNumber=$c.PartitionNumber})
    Check ($limits.current -eq $c.Size -and $null -eq $limits.recovery) 'Live C limits read; unavailable recovery extension rejected'
    'ALL_NATIVE_TESTS_PASSED' | Set-Content -LiteralPath (Join-Path $testRoot 'native-result.txt')
} catch {
    $_ | Out-String | Write-Output
    ('FAILED: ' + $_.Exception.Message) | Set-Content -LiteralPath (Join-Path $testRoot 'native-result.txt')
} finally {
    if ($attached) { Dismount-DiskImage -ImagePath $vhdPath -ErrorAction Continue }
    Stop-Transcript
}
