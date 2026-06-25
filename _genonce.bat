@echo off
call npx --yes fsh-sushi@3.20.0 .
if errorlevel 1 exit /b 1
if not exist input-cache\publisher.jar (
  echo input-cache\publisher.jar is missing. Run _updatePublisher.sh in a Unix-like shell or download publisher.jar manually.
  exit /b 1
)
if "%IG_CONTROL%"=="" set IG_CONTROL=ig-gh-actions.ini
java -jar input-cache\publisher.jar -ig "%IG_CONTROL%" %*
