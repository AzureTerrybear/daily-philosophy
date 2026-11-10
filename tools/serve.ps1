# Local preview server. No Node or Python needed.
#   powershell -File tools/serve.ps1
# Then open http://localhost:8765/?preview=1
param([int]$Port = 8765)
if ($env:PORT) { $Port = [int]$env:PORT }

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$types = @{
  ".html" = "text/html; charset=utf-8"; ".json" = "application/json; charset=utf-8"
  ".mjs"  = "text/javascript; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"; ".mp3" = "audio/mpeg"; ".svg" = "image/svg+xml"
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/  (Ctrl+C to stop)"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart("/")
    if ($rel -eq "") { $rel = "index.html" }
    $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $ctx.Response.ContentType = if ($types[$ext]) { $types[$ext] } else { "application/octet-stream" }
      $ctx.Response.Headers.Add("Cache-Control", "no-store")
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
  } catch {
    $ctx.Response.StatusCode = 500
  } finally {
    $ctx.Response.Close()
  }
}
