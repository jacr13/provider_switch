@echo off
setlocal
pushd "%~dp0.." || exit /b 1

where node >nul 2>&1
if errorlevel 1 (
  echo Error: Install Node.js and add it to PATH first.
  goto :failed
)
where npm >nul 2>&1
if errorlevel 1 (
  echo Error: npm is not available on PATH.
  goto :failed
)

echo Installing build dependencies...
if exist package-lock.json (
  call npm ci
) else (
  call npm install
)
if errorlevel 1 goto :failed

echo Running tests...
call npm test
if errorlevel 1 goto :failed

echo Packaging extension...
call npm run package -- --out provider-switcher.vsix
if errorlevel 1 goto :failed

echo.
echo Built: %CD%\provider-switcher.vsix
set "installAnswer="
set /p "installAnswer=Install this build in VS Code? [y/N]: "
if /i "%installAnswer%"=="y" goto :install
if /i "%installAnswer%"=="yes" goto :install
echo Installation skipped.
popd
exit /b 0

:install
where code >nul 2>&1
if errorlevel 1 (
  echo Error: VS Code's code command is not on PATH.
  echo Use Extensions: Install from VSIX in VS Code to install the built file.
  goto :failed
)
call code --install-extension "%CD%\provider-switcher.vsix" --force
if errorlevel 1 goto :failed
echo Installed. Run Developer: Reload Window in VS Code.
popd
exit /b 0

:failed
echo Build or installation failed.
popd
exit /b 1
