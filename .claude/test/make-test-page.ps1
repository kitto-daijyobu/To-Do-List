# index.html을 복사해서, 진짜 저장소 대신 가짜 저장소(fake-cloud.js)를 쓰는 시험 페이지를 만들어요.
# 미리보기 주소: http://localhost:5500/.claude/test/index.html
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$html = [System.IO.File]::ReadAllText((Join-Path $root 'index.html'), [System.Text.Encoding]::UTF8)
$inject = @'
<head>
  <base href="/">
  <script type="importmap">{ "imports": { "/cloud.js": "/.claude/test/fake-cloud.js" } }</script>
'@
$html = $html.Replace('<head>', $inject)
$out = Join-Path $PSScriptRoot 'index.html'
[System.IO.File]::WriteAllText($out, $html, (New-Object System.Text.UTF8Encoding $false))
"made $out"
