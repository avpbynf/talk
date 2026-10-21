; Talk NSIS installer hooks
; Installs VB-Cable, and reclaims the model cache on uninstall while leaving the
; settings and the history alone.

!macro NSIS_HOOK_PREINSTALL
  ; Install VB-Audio Virtual Cable silently, when its payload is vendored.
  ; The setup exe needs its driver files (.sys, .inf, .cat) in the same directory,
  ; so extract the whole VBCABLE_Driver folder to $TEMP, run setup, then clean up.
  ; VB-Cable requires admin (UAC prompt). If declined, meeting mode is unavailable.
  ;
  ; The payload is not in the repository: it is redistributed by VB-Audio under its
  ; own terms, so fetch it from vb-audio.com and unpack it into
  ; src-tauri/resources/VBCABLE_Driver/ to build an installer that sets it up.
  ; Without it the app still runs and still detects VB-Cable at startup; only the
  ; automatic install goes away, and meeting mode asks for the driver instead.
!if /FileExists "${NSISDIR}\..\..\resources\VBCABLE_Driver\VBCABLE_Setup_x64.exe"
  SetOutPath "$TEMP\VBCABLE_Driver"
  File /r "${NSISDIR}\..\..\resources\VBCABLE_Driver\*.*"
  nsExec::ExecToLog '"$TEMP\VBCABLE_Driver\VBCABLE_Setup_x64.exe" /quiet /norestart'
  RMDir /r "$TEMP\VBCABLE_Driver"
!else
  DetailPrint "VB-Cable payload not bundled; meeting mode needs the driver installed by hand."
!endif
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Only when the uninstaller's own "Delete the application data" box is ticked.
  ;
  ; Installing a newer version over an older one runs the older uninstaller
  ; first, which is the choice the installer offers by default, and this hook
  ; runs there too. Deleting the models unconditionally threw away a gigabyte
  ; and more on every upgrade, and the next dictation had to download them all
  ; again. The box is unticked unless someone ticks it, and Tauri's updater
  ; skips the uninstaller altogether.
  ;
  ; Tauri's own handling of that box deletes %APPDATA%\com.avpbynf.t4lk, which
  ; nothing writes to: the directories crate drops the qualifier, so
  ; ProjectDirs::from("com", "avpbynf", "Talk") keeps only the last argument and
  ; settings, history and models all live under %APPDATA%\avpbynf\Talk.
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RMDir /r "$APPDATA\avpbynf\Talk"
    RMDir "$APPDATA\avpbynf"

    ; The WebView2 profile, which Tauri does name after the bundle identifier.
    RMDir /r "$LOCALAPPDATA\com.avpbynf.t4lk"
  ${EndIf}
!macroend
