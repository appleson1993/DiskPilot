const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
function gaps(disk) {
  const out = [];
  let cursor = MiB;
  for (const p of [...disk.partitions].sort((a, b) => a.offset - b.offset)) {
    if (p.offset - cursor >= 2 * MiB) out.push({ offset: cursor, size: p.offset - cursor });
    cursor = Math.max(cursor, p.offset + p.size);
  }
  const end = Math.floor((disk.size - MiB) / MiB) * MiB;
  if (end - cursor >= 2 * MiB) out.push({ offset: cursor, size: end - cursor });
  return out;
}
function validateRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('無效的操作');
  const types = ['resize', 'create', 'rename', 'format', 'delete', 'recoveryExtend'];
  if (!types.includes(input.kind)) throw new Error('不支援此操作');
  const result = { kind: input.kind };
  for (const key of ['diskNumber', 'partitionNumber', 'offset', 'size']) {
    if (input[key] !== undefined) {
      if (!Number.isSafeInteger(input[key]) || input[key] < 0) throw new Error(`無效的 ${key}`);
      result[key] = input[key];
    }
  }
  if (result.diskNumber === undefined) throw new Error('請選擇磁碟');
  if (input.kind !== 'create' && result.partitionNumber === undefined) throw new Error('請選擇分割區');
  if (['create', 'resize'].includes(input.kind) && !(result.size >= 64 * MiB)) throw new Error('容量至少需要 64 MiB');
  if (input.kind === 'create' && result.offset === undefined) throw new Error('缺少未配置空間的位置');
  if (['create', 'format', 'rename'].includes(input.kind)) {
    if (typeof input.label !== 'string' || input.label.length > 32 || /[\\/:*?"<>|\x00-\x1f]/.test(input.label)) throw new Error('磁碟標籤最多 32 字，不可含特殊字元');
    result.label = input.label;
  }
  if (['format', 'create'].includes(input.kind)) {
    if (input.fileSystem !== 'NTFS') throw new Error('目前支援 NTFS');
    result.fileSystem = 'NTFS';
  }
  if (input.kind === 'create') {
    if (!/^[D-Z]$/.test(input.letter)) throw new Error('請選擇 D 至 Z 的磁碟機代號');
    result.letter = input.letter;
  }
  return result;
}
module.exports = { MiB, GiB, gaps, validateRequest };
