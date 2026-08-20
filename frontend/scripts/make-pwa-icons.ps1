Add-Type -AssemblyName System.Drawing

function New-MaryIcon {
  param([int]$Size, [string]$Path)
  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(255, 10, 10, 12))
  $pad = [int]($Size * 0.16)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 244, 114, 182))
  $g.FillEllipse($brush, $pad, $pad, $Size - (2 * $pad), $Size - (2 * $pad))
  $fontSize = [single]($Size * 0.34)
  $style = [System.Drawing.FontStyle]::Bold
  $unit = [System.Drawing.GraphicsUnit]::Pixel
  $font = New-Object System.Drawing.Font('Georgia', $fontSize, $style, $unit)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, ($Size * 0.04), $Size, $Size)
  $g.DrawString('ME', $font, [System.Drawing.Brushes]::White, $rect, $sf)
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  $brush.Dispose()
  $font.Dispose()
}

$root = Join-Path $PSScriptRoot '..\public'
New-MaryIcon -Size 180 -Path (Join-Path $root 'apple-touch-icon.png')
New-MaryIcon -Size 192 -Path (Join-Path $root 'icon-192.png')
New-MaryIcon -Size 512 -Path (Join-Path $root 'icon-512.png')
Get-ChildItem $root -Filter '*.png' | Select-Object Name, Length
