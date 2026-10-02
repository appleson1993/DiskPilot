DiskPilot 磁碟管家 1.0.0 — Windows x64
====================================

開啟 DiskPilot-1.0.0-Windows-x64.exe 即可使用，不需自行安裝 Node.js。
這是 portable 版本，初次解壓啟動需要幾秒鐘。預設以瀏覽模式啟動。
需要修改時，點右上角「開啟管理員模式」，並接受 Windows 權限提示。
此版本沒有商用程式碼簽章，發行者不會顯示為已驗證。

可用功能
--------
• 即時讀取磁碟、分割區、容量、可用空間、GPT／MBR 格式。
• 圖形化配置圖、NTFS 容量調整滑桿、調整前後預覽。
• 延伸相鄰未配置空間、縮小分割區。
• 在未配置空間建立 NTFS 分割區，指定磁碟機代號及標籤。
• 重新命名分割區；格式化及刪除一般資料分割區。
• 特定配置下的 Windows RE 重建與系統槽延伸。
• 待執行操作、原生確認視窗、操作紀錄、JSON 報告匯出。

操作方式
--------
1. 選取磁碟配置圖中的分割區。
2. 選擇「調整容量」，拖動滑桿或輸入目標 GiB。
3. 加入待執行清單，檢查調整前後的容量。
4. 按「套用變更」並完成確認。
5. 等待完成；程式會重新讀取磁碟資訊。

新建分割區：選取「未配置」區域，再選「建立新分割區」。
一次只執行一個操作，完成後重新規劃下一個操作。
GiB 與 Windows 檔案總管常標示的 GB 相當（1024^3 bytes）。

復原區延伸
----------
只支援「目前 Windows 系統槽 → 單一 Windows RE 復原區 → 未配置空間」。
需要未加密的 NTFS 系統槽，且至少 2 GiB 可用空間。
執行時備份 Winre.wim 及 BCD，校驗映像，重建至少 1 GiB 的復原區，
確認 Windows RE 已啟用後才延伸系統槽。
備份保留在 C:\ProgramData\DiskPilot\Backups。
備份僅包含復原映像和開機設定，不是個人檔案或整顆磁碟備份。
步驟中斷時會顯示失敗原因及備份位置；部分磁碟變更可能已完成。

支援範圍
--------
支援已初始化且健康的基本 GPT／MBR 磁碟與 NTFS 資料分割區。
不支援動態磁碟、Storage Spaces、iSCSI、擴充／邏輯分割區、
BitLocker 加密磁碟修改、任意搬移分割區、跨越資料槽合併、
硬碟複製、系統遷移、資料救援、線上更新、雲端服務。
不提供 EFI、系統保留、Windows 系統槽的格式化或刪除。
MBR 新建分割區一律明確建立主要分割區，不自動建立擴充區。
分割區操作不能增加實體硬碟容量；虛擬機器需要先在主機擴大磁碟。

本次驗證
--------
已完成實機唯讀磁碟掃描、Electron 啟動、介面導覽、保護區互動、
1100px 視窗排版、請求驗證測試與模擬原生預檢測試。
介面容量調整與待執行流程另外使用測試資料驗證。
專用 VHDX 的實際寫入測試未執行：Windows 管理員提示被取消。
Windows RE 自動重建也尚未在本 App 內完成實際寫入驗證。
因此這份版本屬於可執行的初版，重要磁碟操作前請先建立完整備份，
建議先在拋棄式虛擬機／測試磁碟完成管理員整合測試。

開發及重建
----------
使用 Node.js 及 npm。原始碼包不含 node_modules。
  npm ci
  node node_modules/electron/install.js
  npm start
  npm test
  powershell -NoProfile -ExecutionPolicy Bypass -File test/native-planning.ps1
  npm run build

管理員整合測試：test/native-integration.ps1
只會建立專用 1 GiB VHDX，驗證建立、延伸、縮小、檔案完整性、
命名、格式化、刪除與過期配置保護，完成後卸載該測試映像。
不修改實體 C 槽。C 槽僅用來讀取範圍及確認系統刪除被拒絕。
若同路徑已有測試映像會停止，避免覆寫。

應用程式架構
------------
src/main.cjs        Electron 主程序與限制用途的 IPC
src/preload.cjs     contextBridge 權限邊界
src/renderer.js     介面與操作預覽
src/styles.css     原創桌面介面
src/model.cjs      操作請求驗證
native/disk.ps1     Windows Storage / DiskPart / REAgentC 操作層

參考資料
--------
EaseUS 功能及流程參考（不是其官方產品或授權版本）：
https://www.easeus.com/support/partition-master/index.html
https://www.easeus.com/tutorial/epm-free-user-guide.html
Electron 安全建議：
https://www.electronjs.org/docs/latest/tutorial/security
Windows 儲存指令：
https://learn.microsoft.com/powershell/module/storage/resize-partition
https://learn.microsoft.com/powershell/module/storage/get-partitionsupportedsize
Windows RE：
https://learn.microsoft.com/zh-tw/windows-hardware/manufacture/desktop/deploy-windows-re
