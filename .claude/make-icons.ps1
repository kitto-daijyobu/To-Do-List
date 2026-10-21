# 앱 아이콘(네잎 클로버) PNG를 만들어요. 색을 바꾸고 싶으면 $leafColors를 고친 뒤 다시 실행하세요.
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'icons'
New-Item -ItemType Directory -Force $outDir | Out-Null

$background = [System.Drawing.ColorTranslator]::FromHtml('#EEF3FA')
$leafColors = @('#5B8DEF', '#8E7CE0', '#4DB6A0', '#F0A96B') # 왼쪽 위, 오른쪽 위, 오른쪽 아래, 왼쪽 아래

# size: 그림 크기, scale: 클로버가 차지하는 비율 (maskable은 잘려도 되게 작게)
function New-Icon([int]$size, [double]$scale, [string]$name, [bool]$rounded) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $bgBrush = New-Object System.Drawing.SolidBrush $background
  if ($rounded) {
    $r = $size * 0.22
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
    $path.AddArc($size - $r * 2, 0, $r * 2, $r * 2, 270, 90)
    $path.AddArc($size - $r * 2, $size - $r * 2, $r * 2, $r * 2, 0, 90)
    $path.AddArc(0, $size - $r * 2, $r * 2, $r * 2, 90, 90)
    $path.CloseFigure()
    $g.FillPath($bgBrush, $path)
  } else {
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)
  }

  # 웹 화면의 클로버와 같은 비율: 40칸 안에 반지름 10.5 원 4개 (중심 13·27)
  $unit = $size * $scale / 40
  $offset = ($size - 40 * $unit) / 2
  $centers = @(@(13, 13), @(27, 13), @(27, 27), @(13, 27))
  for ($i = 0; $i -lt 4; $i++) {
    $c = [System.Drawing.ColorTranslator]::FromHtml($leafColors[$i])
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(217, $c.R, $c.G, $c.B))
    $cx = $offset + $centers[$i][0] * $unit
    $cy = $offset + $centers[$i][1] * $unit
    $rad = 10.5 * $unit
    $g.FillEllipse($brush, [float]($cx - $rad), [float]($cy - $rad), [float]($rad * 2), [float]($rad * 2))
  }

  $bmp.Save((Join-Path $outDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

New-Icon 512 0.78 'icon-512.png' $true
New-Icon 192 0.78 'icon-192.png' $true
New-Icon 512 0.60 'icon-maskable-512.png' $false
New-Icon 180 0.74 'apple-touch-icon.png' $false
New-Icon 32 0.95 'favicon-32.png' $false
Get-ChildItem $outDir | Select-Object Name, Length
