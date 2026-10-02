; Talk NSIS installer hooks
; Retires the installation the old name left, and reclaims the model cache on
; uninstall while leaving the settings and the history alone.

!macro NSIS_HOOK_PREINSTALL
  ; Retire the installation left by the old name.
  ;
  ; Tauri builds UNINSTKEY from the product name, not from the bundle identifier,
  ; so the entry T4lk wrote is invisible to this installer. Left alone, Windows
  ; lists two applications, keeps two Start Menu shortcuts, and leaves the old
  ; binary on disk forever.
  ;
  ; Never do this by running the old uninstaller. Its own POSTUNINSTALL hook wipes
  ; com.avpbynf.t4lk, which is where the settings, the history and the downloaded
  ; model live, and preserving those is the entire reason the identifier did not
  ; change with the name. Delete the old files and keys directly instead.
  Push $9
  ReadRegStr $9 SHCTX "Software\${MANUFACTURER}\T4lk" ""
  StrCmp "$9" "" legacy_files_done 0
    DetailPrint "Removing the previous installation, which was named T4lk."
    RMDir /r "$9"
  legacy_files_done:
  Pop $9
  DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\T4lk"
  DeleteRegKey SHCTX "Software\${MANUFACTURER}\T4lk"
  DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Run" "T4lk"
  Delete "$SMPROGRAMS\T4lk.lnk"
  Delete "$SMPROGRAMS\$AppStartMenuFolder\T4lk.lnk"
  Delete "$DESKTOP\T4lk.lnk"

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
  ; ProjectDirs::from("com", "avpbynf", "t4lk") keeps only the last argument and
  ; settings, history and models all live under %APPDATA%\avpbynf\t4lk.
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RMDir /r "$APPDATA\avpbynf\t4lk"
    RMDir "$APPDATA\avpbynf"

    ; The WebView2 profile, which Tauri does name after the bundle identifier.
    RMDir /r "$LOCALAPPDATA\com.avpbynf.t4lk"
  ${EndIf}
!macroend
