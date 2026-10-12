; Coderio installer customization for electron-builder's NSIS template.
;
; Adds the install directory to the CURRENT USER's PATH so editors can reach
; the `coderio` command-line tool, and writes a `coderio.cmd` shim that runs
; the CLI through the bundled Electron runtime (ELECTRON_RUN_AS_NODE=1) so it
; never depends on a system Node installation.
;
; The uninstaller deletes the shim and reverts the PATH change (only the tail
; we appended ourselves is removed; unrelated entries are untouched).

!include "LogicLib.nsh"
!include "WinMessages.nsh"

!macro CoderioAddToPath
    ReadRegStr $0 HKCU "Environment" "Path"
    ${If} $0 == ""
        StrCpy $1 "$INSTDIR"
    ${Else}
        ${If} "$0" != "*$INSTDIR*"
            StrCpy $1 "$0;$INSTDIR"
        ${Else}
            ; Already present — don't append a duplicate.
            StrCpy $1 "$0"
        ${EndIf}
    ${EndIf}
    WriteRegExpandStr HKCU "Environment" "Path" $1
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro CoderioRemoveFromPath
    ReadRegStr $1 HKCU "Environment" "Path"
    StrCmp $1 "" done
    StrLen $2 "$INSTDIR"
    ; Only an appended tail ("<prefix>;$INSTDIR") or the bare value is removed.
    StrCpy $3 $1 $2 -$2
    StrCmp $3 "$INSTDIR" tail notail
tail:
    StrLen $4 $1
    IntOp $4 $4 - $2
    StrCpy $5 $1 $4
    StrCmp $5 "" clear
    StrCpy $6 $5 1 -1
    StrCmp $6 ";" trim kept
trim:
    IntOp $4 $4 - 1
    StrCpy $5 $1 $4
kept:
    WriteRegExpandStr HKCU "Environment" "Path" $5
    Goto done
clear:
    DeleteRegValue HKCU "Environment" "Path"
    Goto done
notail:
    ; Not present (e.g. user removed it manually) — nothing to do.
done:
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro CoderioWriteCliShim
    ; `%~dp0` resolves to the .cmd's own folder at runtime, so the shim stays
    ; valid even if the user moves the install directory. The app payload is
    ; unpacked under `resources\app` (asar is disabled for this product).
    FileOpen $0 "$INSTDIR\coderio.cmd" w
    FileWrite $0 '@ECHO OFF$\r$\n'
    FileWrite $0 'SETLOCAL$\r$\n'
    FileWrite $0 'SET "ELECTRON_RUN_AS_NODE=1"$\r$\n'
    FileWrite $0 '"%~dp0Coderio.exe" "%~dp0resources\app\dist\cli\index.js" %*$\r$\n'
    FileClose $0
!macroend

!macro customInstall
    !insertmacro CoderioAddToPath
    !insertmacro CoderioWriteCliShim
!macroend

!macro customUnInstall
    Delete /REBOOTOK "$INSTDIR\coderio.cmd"
    !insertmacro CoderioRemoveFromPath
!macroend