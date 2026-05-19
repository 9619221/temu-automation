!macro customInstall
  ; 使用 64 位注册表视图写入浏览器策略。
  SetRegView 64

  ; HKCU 无需管理员权限，始终写入 Chrome 和 Edge 强制安装策略。
  WriteRegStr HKCU "SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" "9001" "ejheeafceahglndenffjkcmojpiomcpg;https://erp.temu.chat/ext/update.xml"
  WriteRegStr HKCU "SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist" "9001" "ejheeafceahglndenffjkcmojpiomcpg;https://erp.temu.chat/ext/update.xml"

  ; HKLM 需要管理员权限，失败时静默降级，不中断安装。
  ClearErrors
  WriteRegStr HKLM "SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" "9001" "ejheeafceahglndenffjkcmojpiomcpg;https://erp.temu.chat/ext/update.xml"
  IfErrors 0 +2
    ClearErrors

  ClearErrors
  WriteRegStr HKLM "SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist" "9001" "ejheeafceahglndenffjkcmojpiomcpg;https://erp.temu.chat/ext/update.xml"
  IfErrors 0 +2
    ClearErrors

  ; 恢复 electron-builder/NSIS 之前使用的注册表视图。
  SetRegView lastused
!macroend

!macro customUnInstall
  ; 使用 64 位注册表视图移除本安装器写入的策略值。
  SetRegView 64

  ; 只删除值名 9001，不删除子键，避免影响其它策略。
  DeleteRegValue HKCU "SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" "9001"
  DeleteRegValue HKCU "SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist" "9001"

  ; HKLM 删除失败时静默跳过，避免卸载流程中断。
  ClearErrors
  DeleteRegValue HKLM "SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" "9001"
  IfErrors 0 +2
    ClearErrors

  ClearErrors
  DeleteRegValue HKLM "SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist" "9001"
  IfErrors 0 +2
    ClearErrors

  ; 恢复 electron-builder/NSIS 之前使用的注册表视图。
  SetRegView lastused
!macroend
