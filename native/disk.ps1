param([ValidateSet('scan','limits','plan','apply')][string]$Action, [string]$InputFile)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$script:Notes = New-Object System.Collections.Generic.List[string]
function Assert-Admin {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw '請先以管理員模式重新開啟 DiskPilot。' }
}
function Is-Recovery($p) { return $p.MbrType -eq 39 -or [string]$p.GptType -eq '{de94bba4-06d1-4d40-a16a-bfd50179d6ac}' }
function Fingerprint($number) {
    $d = Get-Disk -Number $number
    $data = [ordered]@{ number=$d.Number; id=[string]$d.UniqueId; size=$d.Size; style=[string]$d.PartitionStyle; partitions=@(Get-Partition -DiskNumber $number | Sort-Object Offset | ForEach-Object { [ordered]@{ number=$_.PartitionNumber; offset=$_.Offset; size=$_.Size; type=[string]$_.Type; mbr=$_.MbrType; gpt=[string]$_.GptType; letter=[string]$_.DriveLetter } }) }
    $bytes = [Text.Encoding]::UTF8.GetBytes(($data | ConvertTo-Json -Depth 6 -Compress))
    return ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes))).Replace('-','')
}
function Assert-Disk($number) {
    $d = Get-Disk -Number $number
    if ($d.IsOffline -or $d.IsReadOnly -or [string]$d.HealthStatus -ne 'Healthy') { throw '磁碟離線、唯讀或健康狀態異常，無法變更。' }
    if ([string]$d.PartitionStyle -notin @('MBR','GPT')) { throw '此版本只支援已初始化的基本 MBR / GPT 磁碟。' }
    $parts = @(Get-Partition -DiskNumber $number)
    if ($parts | Where-Object { $_.MbrType -in @(5,15,66) -or $_.PartitionNumber -eq 0 -or [string]$_.GptType -in @('{5808c8aa-7e8f-42e0-85d2-e1e90434cfb3}','{af9b60a0-1431-4f62-bc68-3311714a69ad}') }) { throw '此版本不修改動態磁碟或含擴充／邏輯分割區的磁碟。' }
    if ([string]$d.BusType -in @('Spaces','iSCSI')) { throw '儲存空間與 iSCSI 磁碟不支援修改。' }
    return $d
}
function Get-PlainVolume($p) {
    $v = $p | Get-Volume
    if ([string]$v.FileSystemType -ne 'NTFS' -or [string]$v.HealthStatus -ne 'Healthy') { throw '請選擇健康的 NTFS 分割區。' }
    if (-not $p.DriveLetter -or [int][char]$p.DriveLetter -eq 0) { throw '請選擇具有磁碟機代號的資料分割區。' }
    try {
        $enc = Get-CimInstance -Namespace 'root/CIMV2/Security/MicrosoftVolumeEncryption' -ClassName Win32_EncryptableVolume -Filter ("DriveLetter='" + $p.DriveLetter + ":'") -ErrorAction Stop
        if ($enc) {
            $conversion = Invoke-CimMethod -InputObject $enc -MethodName GetConversionStatus
            if ($conversion.ReturnValue -ne 0 -or $conversion.ConversionStatus -ne 0) { throw 'BITLOCKER' }
        }
    } catch { throw '無法確認磁碟未加密，或磁碟正在使用 BitLocker；請先完成解密再操作。' }
    return $v
}
function Assert-Target($q) {
    $null = Assert-Disk $q.diskNumber
    $p = Get-Partition -DiskNumber $q.diskNumber -PartitionNumber $q.partitionNumber
    if ($p.IsSystem -or (Is-Recovery $p) -or [string]$p.GptType -eq '{e3c9e316-0b5c-4db8-817d-f92df00215ae}') { throw '系統啟動、保留及復原分割區受到保護。' }
    $null = Get-PlainVolume $p
    if ($q.kind -in @('delete','format')) {
        if ($p.IsBoot -or $p.IsSystem -or $p.IsActive -or $p.IsHidden -or [string]$p.DriveLetter -eq $env:SystemDrive.TrimEnd(':')) { throw '不能刪除或格式化 Windows 系統分割區。' }
        $page = @(Get-CimInstance Win32_PageFileUsage -ErrorAction Stop)
        if ($page | Where-Object { $_.Name.StartsWith(([string]$p.DriveLetter + ':'), [StringComparison]::OrdinalIgnoreCase) }) { throw '此分割區正用於分頁檔，不能刪除或格式化。' }
    }
    return $p
}
function Get-Gaps($disk) {
    $result = @(); $cursor = [long]1MB
    foreach ($p in @(Get-Partition -DiskNumber $disk.Number | Sort-Object Offset)) {
        if ($p.Offset - $cursor -ge 2MB) { $result += [pscustomobject]@{ offset=$cursor; size=($p.Offset-$cursor) } }
        $cursor = [math]::Max($cursor, $p.Offset + $p.Size)
    }
    $end = [long]([math]::Floor(($disk.Size - 1MB) / 1MB) * 1MB)
    if ($end - $cursor -ge 2MB) { $result += [pscustomobject]@{ offset=$cursor; size=($end-$cursor) } }
    return $result
}
function Get-Inventory {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    $disks = @(Get-Disk | Sort-Object Number | ForEach-Object {
        $d = $_
        $parts = @(Get-Partition -DiskNumber $d.Number -ErrorAction SilentlyContinue | Sort-Object Offset | ForEach-Object {
            $p = $_; $v = $null
            try { $v = $p | Get-Volume -ErrorAction Stop } catch {}
            $letter = [string]$p.DriveLetter
            if ($letter -eq [string][char]0) { $letter = '' }
            [ordered]@{ number=$p.PartitionNumber; offset=$p.Offset; size=$p.Size; letter=$letter; label=[string]$v.FileSystemLabel; fileSystem=[string]$v.FileSystemType; free=$v.SizeRemaining; health=[string]$v.HealthStatus; type=[string]$p.Type; recovery=(Is-Recovery $p); boot=$p.IsBoot; system=$p.IsSystem; hidden=$p.IsHidden; mbrType=$p.MbrType; gptType=[string]$p.GptType }
        })
        [ordered]@{ number=$d.Number; name=[string]$d.FriendlyName; serial=[string]$d.SerialNumber; size=$d.Size; style=[string]$d.PartitionStyle; bus=[string]$d.BusType; health=[string]$d.HealthStatus; offline=$d.IsOffline; readOnly=$d.IsReadOnly; partitions=$parts; gaps=@(Get-Gaps $d); fingerprint=(Fingerprint $d.Number) }
    })
    return [ordered]@{ disks=$disks; admin=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); computer=$env:COMPUTERNAME; time=(Get-Date).ToString('o'); usedLetters=@(Get-Volume | Where-Object DriveLetter | ForEach-Object { [string]$_.DriveLetter }) }
}
function Get-RecoveryLayout($q) {
    $disk = Assert-Disk $q.diskNumber
    $p = Assert-Target $q
    if (-not $p.IsBoot -or [string]$p.DriveLetter -ne $env:SystemDrive.TrimEnd(':')) { throw '復原區延伸功能只適用目前執行中的 Windows 系統槽。' }
    $after = @(Get-Partition -DiskNumber $disk.Number | Where-Object { $_.Offset -ge ($p.Offset + $p.Size) } | Sort-Object Offset)
    if ($after.Count -ne 1 -or -not (Is-Recovery $after[0])) { throw '需要「Windows → 單一復原分割區 → 未配置空間」的配置；不會移動一般資料分割區。' }
    $recovery = $after[0]
    $info = (& reagentc /info | Out-String)
    if ($LASTEXITCODE -ne 0 -or $info -notmatch 'Enabled' -or $info -notmatch ('harddisk' + $disk.Number + '\\partition' + $recovery.PartitionNumber + '\\Recovery\\WindowsRE')) { throw 'Windows RE 狀態或位置不符合預期，請先修復復原環境。' }
    $reserve = [long]([math]::Max(1GB, [math]::Ceiling($recovery.Size / 1MB) * 1MB))
    $offset = [long]([math]::Floor(($disk.Size - 1MB - $reserve) / 1MB) * 1MB)
    $size = $offset - $p.Offset
    if ($offset -lt ($recovery.Offset + $recovery.Size) -or $size -le ($p.Size + 64MB)) { throw '復原分割區後方沒有足夠未配置空間。請先擴大虛擬硬碟或新增實體硬碟容量。' }
    $volume = $p | Get-Volume
    if ($volume.SizeRemaining -lt 2GB) { throw 'C 槽至少需有 2 GiB 可用空間，以保存復原映像備份。' }
    return [ordered]@{ number=$recovery.PartitionNumber; offset=$offset; reserve=$reserve; size=$size; originalOffset=$recovery.Offset; originalSize=$recovery.Size }
}
function Get-Limits($q) {
    Assert-Admin
    $p = Assert-Target $q
    $limits = Get-PartitionSupportedSize -DiskNumber $q.diskNumber -PartitionNumber $q.partitionNumber
    $recovery = $null; $reason = ''
    try { $recovery = Get-RecoveryLayout $q } catch { $reason = $_.Exception.Message }
    return [ordered]@{ min=$limits.SizeMin; max=$limits.SizeMax; current=$p.Size; recovery=$recovery; recoveryReason=$reason }
}
function Make-Plan($q) {
    Assert-Admin
    if ($q.kind -notin @('resize','create','rename','delete','format','recoveryExtend')) { throw '未知操作。' }
    $disk = Assert-Disk $q.diskNumber
    $p = $null; $recovery = $null; $before = 0; $after = 0
    if ($q.kind -ne 'create') { $p = Assert-Target $q; $before = $p.Size; $after = $p.Size }
    $target = '磁碟 ' + $disk.Number
    if ($p) { $target += ' / ' + $p.DriveLetter + ':' }
    $warning = '請先備份重要資料，操作期間請勿關機。'
    $destructive = $q.kind -in @('delete','format')
    if ($q.kind -in @('create','rename','format')) {
        if ($null -eq $q.label -or $q.label.Length -gt 32 -or $q.label -match '[\\/:*?"<>|\x00-\x1f]') { throw '無效的磁碟標籤。' }
    }
    switch ($q.kind) {
        'resize' {
            $limit = Get-PartitionSupportedSize -DiskNumber $disk.Number -PartitionNumber $p.PartitionNumber
            if ($q.size -lt $limit.SizeMin -or $q.size -gt $limit.SizeMax -or $q.size -lt 64MB) { throw '容量超出 Windows 目前允許的範圍，請重新整理。' }
            if ([math]::Abs($q.size - $p.Size) -lt 1MB) { throw '容量沒有變更。' }
            $after = [long]$q.size
            $title = '調整 ' + $target + ' 容量'
        }
        'create' {
            if ($q.fileSystem -ne 'NTFS' -or $q.letter -notmatch '^[D-Z]$' -or $q.size -lt 64MB) { throw '新分割區設定無效。' }
            if (Get-Volume -DriveLetter $q.letter -ErrorAction SilentlyContinue) { throw '磁碟機代號已被使用。' }
            $gap = @(Get-Gaps $disk | Where-Object { $_.offset -eq $q.offset -and $_.size -ge $q.size })
            if ($gap.Count -ne 1 -or $q.offset % 1MB -ne 0 -or $q.size % 1MB -ne 0) { throw '未配置空間已改變或未對齊，請重新整理。' }
            if ([string]$disk.PartitionStyle -eq 'MBR' -and @(Get-Partition -DiskNumber $disk.Number).Count -ge 4) { throw 'MBR 已達四個主要分割區上限。' }
            $after = [long]$q.size; $title = '建立 ' + $q.letter + ': 分割區'
        }
        'rename' { $title = '重新命名 ' + $target }
        'format' { if ($q.fileSystem -ne 'NTFS') { throw '僅支援 NTFS。' }; $title = '格式化 ' + $target; $warning = '此分割區的所有檔案都會被刪除，無法復原。' }
        'delete' { $title = '刪除 ' + $target; $after = 0; $warning = '此分割區及其中所有檔案都會被刪除，無法復原。' }
        'recoveryExtend' { $recovery = Get-RecoveryLayout $q; $after = $recovery.size; $title = '延伸 ' + $target + ' 並重建復原區'; $warning = '將備份 Windows RE、重建復原分割區，再延伸 Windows。中途失敗會保留備份，但部分變更可能已完成。請先建立外部備份。' }
    }
    $summary = $target + '：' + [math]::Round($before / 1GB, 2) + ' GiB → ' + [math]::Round($after / 1GB, 2) + ' GiB'
    if ($q.kind -eq 'rename') { $summary = $target + ' 的標籤將改為「' + $q.label + '」。' }
    return [ordered]@{ request=$q; fingerprint=(Fingerprint $disk.Number); title=$title; summary=$summary; warning=$warning; destructive=$destructive; confirmation=('DELETE ' + $p.DriveLetter); before=$before; after=$after; recovery=$recovery }
}
function Run-Diskpart($commands) {
    $file = Join-Path ([IO.Path]::GetTempPath()) (([guid]::NewGuid().ToString()) + '.txt')
    try {
        $commands | Set-Content -LiteralPath $file -Encoding ASCII
        $out = (& diskpart /s $file | Out-String)
        $script:Notes.Add($out)
        if ($LASTEXITCODE -ne 0) { throw 'DiskPart 操作失敗。' }
    } finally { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
}
function Run-Reagent($arguments) {
    $out = (& reagentc @arguments | Out-String)
    $script:Notes.Add($out)
    if ($LASTEXITCODE -ne 0) { throw ('Windows RE 操作失敗：' + $out) }
    return $out
}
function Extend-WithRecovery($q, $layout) {
    $backup = Join-Path $env:ProgramData ('DiskPilot\Backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    $script:Notes.Add('Recovery backup: ' + $backup)
    $letters = @(Get-Volume | Where-Object DriveLetter | ForEach-Object { [string]$_.DriveLetter })
    $letter = @('R','S','T','U','V','W','X','Y','Z') | Where-Object { $_ -notin $letters } | Select-Object -First 1
    if (-not $letter) { throw '需要一個可用磁碟機代號暫時存取復原區。' }
    $old = Get-Partition -DiskNumber $q.diskNumber -PartitionNumber $layout.number
    $mounted = $false; $deleted = $false; $new = $null
    try {
        if ($old.DriveLetter -and [int][char]$old.DriveLetter -ne 0) { throw '復原分割區已有磁碟機代號，請先檢查配置。' }
        Add-PartitionAccessPath -DiskNumber $q.diskNumber -PartitionNumber $old.PartitionNumber -AccessPath ($letter + ':\')
        $mounted = $true
        $source = $letter + ':\Recovery\WindowsRE\Winre.wim'
        $image = Get-Item -LiteralPath $source -Force
        $c = Get-Volume -DriveLetter $env:SystemDrive.TrimEnd(':')
        if ($c.SizeRemaining -lt (2 * $image.Length + 512MB)) { throw '沒有足夠空間備份復原映像。' }
        Copy-Item -LiteralPath $source -Destination (Join-Path $backup 'Winre.wim') -Force
        $hash = (Get-FileHash -LiteralPath $source).Hash
        if ((Get-FileHash -LiteralPath (Join-Path $backup 'Winre.wim')).Hash -ne $hash) { throw '復原映像備份驗證失敗。' }
        $null = & bcdedit /export (Join-Path $backup 'BCD')
        if ($LASTEXITCODE -ne 0) { throw '無法備份開機設定。' }
        $q | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'request.json') -Encoding UTF8
        $null = Run-Reagent @('/disable')
        Remove-PartitionAccessPath -DiskNumber $q.diskNumber -PartitionNumber $old.PartitionNumber -AccessPath ($letter + ':\')
        $mounted = $false
        Run-Diskpart @(('select disk ' + $q.diskNumber), ('select partition ' + $old.PartitionNumber), 'delete partition override')
        if (Get-Partition -DiskNumber $q.diskNumber | Where-Object { $_.Offset -eq $old.Offset }) { throw '舊復原區未移除。' }
        $deleted = $true
        Run-Diskpart @(('select disk ' + $q.diskNumber), ('create partition primary offset=' + [long]($layout.offset / 1KB) + ' size=' + [long]($layout.reserve / 1MB)))
        $new = Get-Partition -DiskNumber $q.diskNumber | Where-Object { $_.Offset -eq $layout.offset -and $_.Size -eq $layout.reserve }
        if (-not $new) { throw '新復原分割區的位置驗證失敗。' }
        $new | Format-Volume -FileSystem NTFS -NewFileSystemLabel 'Windows RE tools' -Confirm:$false | Out-Null
        Add-PartitionAccessPath -DiskNumber $q.diskNumber -PartitionNumber $new.PartitionNumber -AccessPath ($letter + ':\')
        $mounted = $true
        $folder = $letter + ':\Recovery\WindowsRE'
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $backup 'Winre.wim') -Destination (Join-Path $folder 'Winre.wim') -Force
        if ((Get-FileHash -LiteralPath (Join-Path $folder 'Winre.wim')).Hash -ne $hash) { throw '新復原映像驗證失敗。' }
        $d = Get-Disk -Number $q.diskNumber
        $commands = @(('select disk ' + $q.diskNumber), ('select partition ' + $new.PartitionNumber))
        if ([string]$d.PartitionStyle -eq 'GPT') { $commands += @('set id=de94bba4-06d1-4d40-a16a-bfd50179d6ac override','gpt attributes=0x8000000000000001') } else { $commands += 'set id=27 override' }
        Run-Diskpart $commands
        $null = Run-Reagent @('/setreimage','/path',$folder)
        $null = Run-Reagent @('/enable')
        $info = Run-Reagent @('/info')
        if ($info -notmatch 'Enabled' -or $info -notmatch ('harddisk' + $q.diskNumber + '\\partition' + $new.PartitionNumber + '\\Recovery\\WindowsRE')) { throw 'Windows RE 最終驗證失敗。' }
        $limit = Get-PartitionSupportedSize -DiskNumber $q.diskNumber -PartitionNumber $q.partitionNumber
        if ($limit.SizeMax -lt $layout.size) { throw 'C 槽可延伸大小與預期不同。' }
        Resize-Partition -DiskNumber $q.diskNumber -PartitionNumber $q.partitionNumber -Size $layout.size
        return $backup
    } catch {
        if (-not $deleted) { try { $null = Run-Reagent @('/enable') } catch {} }
        throw ($_.Exception.Message + ' 復原備份保留在：' + $backup + '。請勿刪除備份，請先檢查磁碟及 Windows RE 狀態。')
    } finally {
        if ($mounted) {
            $number = $old.PartitionNumber
            if ($new) { $number = $new.PartitionNumber }
            try { Remove-PartitionAccessPath -DiskNumber $q.diskNumber -PartitionNumber $number -AccessPath ($letter + ':\') } catch {}
        }
    }
}
function Apply-Plan($plan) {
    Assert-Admin
    if ((Fingerprint $plan.request.diskNumber) -ne $plan.fingerprint) { throw '磁碟配置已改變；未執行任何操作。請重新整理後再試。' }
    $fresh = Make-Plan $plan.request
    if ($fresh.after -ne $plan.after) { throw '操作條件已改變，請重新準備。' }
    $q = $plan.request; $backup = $null
    switch ($q.kind) {
        'resize' { Resize-Partition -DiskNumber $q.diskNumber -PartitionNumber $q.partitionNumber -Size $q.size }
        'rename' { Get-Partition -DiskNumber $q.diskNumber -PartitionNumber $q.partitionNumber | Get-Volume | Set-Volume -NewFileSystemLabel $q.label }
        'format' { Get-Partition -DiskNumber $q.diskNumber -PartitionNumber $q.partitionNumber | Format-Volume -FileSystem NTFS -NewFileSystemLabel $q.label -Confirm:$false | Out-Null }
        'delete' { Remove-Partition -DiskNumber $q.diskNumber -PartitionNumber $q.partitionNumber -Confirm:$false }
        'create' {
            Run-Diskpart @(('select disk ' + $q.diskNumber), ('create partition primary offset=' + [long]($q.offset / 1KB) + ' size=' + [long]($q.size / 1MB)))
            $new = Get-Partition -DiskNumber $q.diskNumber | Where-Object { $_.Offset -eq $q.offset -and $_.Size -eq $q.size }
            if (-not $new) { throw '新分割區驗證失敗，未進行格式化。' }
            $new | Format-Volume -FileSystem NTFS -NewFileSystemLabel $q.label -Confirm:$false | Out-Null
            Add-PartitionAccessPath -DiskNumber $q.diskNumber -PartitionNumber $new.PartitionNumber -AccessPath ($q.letter + ':\')
        }
        'recoveryExtend' { $backup = Extend-WithRecovery $q $fresh.recovery }
    }
    if ($q.kind -in @('resize','recoveryExtend')) {
        $p = Get-Partition -DiskNumber $q.diskNumber -PartitionNumber $q.partitionNumber
        if ($p.Size -ne $fresh.after) { throw '變更後容量不符合預期，請檢查磁碟。' }
    }
    $message = $fresh.title + '已完成。'
    if ($backup) { $message += ' 復原備份：' + $backup }
    return [ordered]@{ message=$message; backup=$backup; notes=@($script:Notes.ToArray()) }
}
if ($MyInvocation.InvocationName -eq '.') { return }
try {
    $request = Get-Content -LiteralPath $InputFile -Raw -Encoding UTF8 | ConvertFrom-Json
    switch ($Action) {
        'scan' { $result = Get-Inventory }
        'limits' { $result = Get-Limits $request }
        'plan' { $result = Make-Plan $request }
        'apply' {
            $mutex = New-Object System.Threading.Mutex($false, 'Global\DiskPilot-DiskMutation')
            $owned = $false
            try {
                try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
                if (-not $owned) { throw '另一個 DiskPilot 操作正在進行，請等候完成。' }
                $result = Apply-Plan $request
            } finally { if ($owned) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
        }
    }
    [Console]::WriteLine('DISKPILOT_JSON:' + (@{ ok=$true; data=$result } | ConvertTo-Json -Depth 16 -Compress))
} catch {
    [Console]::WriteLine('DISKPILOT_JSON:' + (@{ ok=$false; error=$_.Exception.Message; notes=@($script:Notes.ToArray()) } | ConvertTo-Json -Depth 8 -Compress))
    exit 1
}
