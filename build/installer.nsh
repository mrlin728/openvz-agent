!macro customInit
  ; Native Node addons are ABI-bound to Electron. Clean old unpacked copies
  ; before installing so upgrades cannot keep a stale better_sqlite3.node.
  RMDir /r "$INSTDIR\resources\app.asar.unpacked\node_modules\better-sqlite3"
!macroend

!macro customUnInstall
  ; 卸载时询问是否同时清除用户数据。升级（${isUpdated}）走的也是卸载旧版流程，
  ; 那种情况绝不能删数据，否则更新一次记忆全没——所以只在“真卸载”时弹窗。
  ; /SD IDNO 让静默卸载默认走“保留”，不打扰、不误删。
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除白龙马的全部用户数据？$\r$\n$\r$\n包括：对话与记忆数据库、配置（含 API Key）、沙盒文件、下载的音乐等。$\r$\n$\r$\n选择「是」将彻底清除且无法恢复；选择「否」保留数据，方便以后重装时继续使用。" /SD IDNO IDNO keepUserData
      ; userData 目录 = %APPDATA%\<productName>，即 $APPDATA\Bailongma
      RMDir /r "$APPDATA\Bailongma"
    keepUserData:
  ${endIf}
!macroend
