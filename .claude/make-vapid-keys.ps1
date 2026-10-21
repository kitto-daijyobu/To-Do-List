# 알림용 열쇠 한 쌍(VAPID, P-256)을 만들어요.
# - 공개 열쇠: push-config.js에 넣어요 (공개돼도 괜찮아요)
# - 비밀 열쇠: .secrets/vapid-jwk.txt 에만 저장해요 (GitHub에 올라가지 않아요). Cloudflare에 붙여넣을 때만 써요.
$root = Split-Path -Parent $PSScriptRoot
$secretDir = Join-Path $root '.secrets'
$secretFile = Join-Path $secretDir 'vapid-jwk.txt'
if (Test-Path $secretFile) { Write-Host 'already exists - not overwriting'; exit 0 }

function B64Url([byte[]]$bytes) { [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_') }

$ec = [System.Security.Cryptography.ECDsa]::Create([System.Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256'))
$p = $ec.ExportParameters($true)
$x = B64Url $p.Q.X
$y = B64Url $p.Q.Y
$d = B64Url $p.D
$public = B64Url ([byte[]](@(4) + $p.Q.X + $p.Q.Y))

New-Item -ItemType Directory -Force $secretDir | Out-Null
$jwk = '{"kty":"EC","crv":"P-256","x":"' + $x + '","y":"' + $y + '","d":"' + $d + '"}'
[System.IO.File]::WriteAllText($secretFile, $jwk, (New-Object System.Text.UTF8Encoding $false))
[System.IO.File]::WriteAllText((Join-Path $secretDir 'vapid-public.txt'), $public, (New-Object System.Text.UTF8Encoding $false))
Write-Host "public key length: $($public.Length)"
