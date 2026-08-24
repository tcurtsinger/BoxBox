# Fetches the Piper TTS engine and the app's baked-in race-engineer voice into
# resources/piper/ (gitignored — ~100MB of binaries don't belong in the repo).
# Run once per checkout before `tauri dev` / `tauri build`:
#   powershell -ExecutionPolicy Bypass -File resources/fetch-voice.ps1
$ErrorActionPreference = "Stop"

$dir = Join-Path $PSScriptRoot "piper"
# All three or nothing: an interrupted run must not latch a half-installed
# voice (Piper needs the .onnx.json sidecar next to the model).
$missing = @("piper.exe", "voice.onnx", "voice.onnx.json") |
    Where-Object { -not (Test-Path (Join-Path $dir $_)) }
if (-not $missing) {
    Write-Host "resources/piper already populated - nothing to do"
    exit 0
}
New-Item -ItemType Directory -Force $dir | Out-Null

$engineZip = Join-Path $env:TEMP "piper_windows_amd64.zip"
Write-Host "Downloading Piper engine..."
Invoke-WebRequest -Uri "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip" -OutFile $engineZip
Expand-Archive -Path $engineZip -DestinationPath $env:TEMP -Force
Copy-Item -Recurse -Force (Join-Path $env:TEMP "piper\*") $dir
Remove-Item $engineZip

# Download to .tmp names, rename only once both parts are on disk, so a killed
# run leaves nothing the completeness check above would mistake for installed.
$voice = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium.onnx"
Write-Host "Downloading voice model (en_GB-northern_english_male-medium)..."
Invoke-WebRequest -Uri $voice -OutFile (Join-Path $dir "voice.onnx.tmp")
Invoke-WebRequest -Uri "$voice.json" -OutFile (Join-Path $dir "voice.onnx.json.tmp")
Move-Item -Force (Join-Path $dir "voice.onnx.json.tmp") (Join-Path $dir "voice.onnx.json")
Move-Item -Force (Join-Path $dir "voice.onnx.tmp") (Join-Path $dir "voice.onnx")

Write-Host "Done: $dir"
