$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\native\disk.ps1')
$script:count = 0
function Check($c, $message) { if (-not $c) { throw ('FAIL: ' + $message) }; $script:count++; Write-Output ('PASS: ' + $message) }
function Expect-Blocked($call, $text, $name) { $blocked=$false;try { $null=& $call } catch { $blocked=$_.Exception.Message -match $text }; Check $blocked $name }
# All operating-system primitives are replaced below. No real disk is modified.
function Assert-Admin {}
function Get-Disk { param($Number) return [pscustomobject]@{Number=99;UniqueId='fixture';Size=70GB;PartitionStyle='MBR';HealthStatus='Healthy';IsOffline=$false;IsReadOnly=$false;BusType='SAS'} }
$script:parts = @(
  [pscustomobject]@{PartitionNumber=1;Offset=1MB;Size=50MB;MbrType=7;GptType='';Type='IFS';DriveLetter='';IsSystem=$true;IsBoot=$false;IsActive=$true;IsHidden=$false},
  [pscustomobject]@{PartitionNumber=2;Offset=51MB;Size=49GB;MbrType=7;GptType='';Type='IFS';DriveLetter='C';IsSystem=$false;IsBoot=$true;IsActive=$false;IsHidden=$false},
  [pscustomobject]@{PartitionNumber=3;Offset=(51MB+49GB);Size=1GB;MbrType=39;GptType='';Type='Unknown';DriveLetter='';IsSystem=$false;IsBoot=$false;IsActive=$false;IsHidden=$false}
)
function Get-Partition { param($DiskNumber,$PartitionNumber) if($PSBoundParameters.ContainsKey('PartitionNumber')) {return $script:parts | Where-Object PartitionNumber -eq $PartitionNumber};return $script:parts }
function Get-Volume { param($DriveLetter,[Parameter(ValueFromPipeline)]$InputObject) process {if(-not $DriveLetter){return [pscustomobject]@{FileSystemType='NTFS';HealthStatus='Healthy';SizeRemaining=10GB;FileSystemLabel='fixture'}}} }
function Get-CimInstance { param($Namespace,$ClassName,$Filter,$ErrorAction) return $null }
function Get-PartitionSupportedSize { param($DiskNumber,$PartitionNumber) return [pscustomobject]@{SizeMin=30GB;SizeMax=49GB} }
function reagentc { $global:LASTEXITCODE=0; return 'Windows RE Enabled \\?\GLOBALROOT\device\harddisk99\partition3\Recovery\WindowsRE' }
$q = [pscustomobject]@{kind='resize';diskNumber=99;partitionNumber=2;size=40GB}
$plan=Make-Plan $q
Check ($plan.before -eq 49GB -and $plan.after -eq 40GB -and -not $plan.destructive) 'Valid shrink preview'
$q.size=50GB
Expect-Blocked {Make-Plan $q} '超出' 'Non-adjacent extension blocked'
$q.kind='delete'
Expect-Blocked {Make-Plan $q} '不能刪除' 'System deletion blocked'
$q.kind='format';$q | Add-Member -NotePropertyName fileSystem -NotePropertyValue NTFS
Expect-Blocked {Make-Plan $q} '不能刪除' 'System formatting blocked'
$q.kind='resize';$q.partitionNumber=3
Expect-Blocked {Make-Plan $q} '受到保護' 'Recovery partition protected'
$q.partitionNumber=1
Expect-Blocked {Make-Plan $q} '受到保護' 'Boot partition protected'
$q.partitionNumber=2;$q.kind='recoveryExtend'
$plan=Make-Plan $q
Check ($plan.recovery.reserve -eq 1GB -and $plan.after -gt 68GB) 'Recovery extension geometry reserves 1 GiB'
$script:parts += [pscustomobject]@{PartitionNumber=4;Offset=60GB;Size=1GB;MbrType=7;GptType='';Type='IFS';DriveLetter='D'}
Expect-Blocked {Make-Plan $q} '單一復原' 'Data partition after recovery blocks relocation'
$script:parts = $script:parts[0..2]
$plan.fingerprint='stale'
Expect-Blocked {Apply-Plan $plan} '配置已改變' 'Stale plans blocked before mutations'
$q=[pscustomobject]@{kind='create';diskNumber=99;offset=(51MB+50GB);size=1GB;letter='D';fileSystem='NTFS';label='資料'}
$plan=Make-Plan $q
Check ($plan.after -eq 1GB -and -not $plan.destructive) 'New partition in exact gap is valid'
$q.offset += 512
Expect-Blocked {Make-Plan $q} '未配置空間' 'Misaligned creation blocked'
$script:parts[2].MbrType=15
Expect-Blocked {Make-Plan $q} '邏輯分割' 'Extended MBR layouts blocked'
Write-Output ('ALL ' + $script:count + ' PLANNING TESTS PASSED')
