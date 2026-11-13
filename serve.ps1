$ErrorActionPreference = "Stop"

$root = (Resolve-Path -LiteralPath $PSScriptRoot).Path.TrimEnd('\') + '\'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:8765/")
$contentTypes = @{
  ".css" = "text/css; charset=utf-8"
  ".glb" = "model/gltf-binary"
  ".html" = "text/html; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg" = "image/svg+xml"
}

$listener.Start()
Write-Host "Virtual Wardrobe disponibile su http://127.0.0.1:8765/"
Write-Host "Premi Ctrl+C per arrestare il server."

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $response = $context.Response

    try {
      if ($context.Request.HttpMethod -notin @("GET", "HEAD")) {
        $response.StatusCode = 405
        $response.Close()
        continue
      }

      $relativePath = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/')).Replace('/', '\')
      if ([string]::IsNullOrWhiteSpace($relativePath)) {
        $relativePath = "index.html"
      }
      $filePath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $relativePath))
      if (-not $filePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        $response.StatusCode = 404
        $response.Close()
        continue
      }

      $file = [System.IO.File]::OpenRead($filePath)
      try {
        $extension = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
        $response.ContentType = if ($contentTypes.ContainsKey($extension)) { $contentTypes[$extension] } else { "application/octet-stream" }
        $response.ContentLength64 = $file.Length
        $response.Headers["X-Content-Type-Options"] = "nosniff"
        if ($context.Request.HttpMethod -eq "GET") {
          $file.CopyTo($response.OutputStream)
        }
      } finally {
        $file.Dispose()
        $response.Close()
      }
    } catch {
      Write-Warning $_.Exception.Message
      if ($response.OutputStream.CanWrite) {
        $response.StatusCode = 500
        $response.Close()
      }
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
