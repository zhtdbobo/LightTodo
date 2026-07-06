!define LIGHTTODO_INSTALL_DIR_NAME "LightTodo"

!macro EnsureLightTodoInstallDir
  ${GetFileName} "$INSTDIR" $R0

  ${If} "$R0" != "${LIGHTTODO_INSTALL_DIR_NAME}"
    StrCpy $INSTDIR "$INSTDIR\${LIGHTTODO_INSTALL_DIR_NAME}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro EnsureLightTodoInstallDir

  SetOutPath "$INSTDIR"
!macroend
