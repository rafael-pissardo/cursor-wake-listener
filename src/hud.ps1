$ErrorActionPreference = "Stop"

Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName WindowsBase

Add-Type @"
using System;
using System.IO;
using System.Threading;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
public static class CursorWakeHudWin {
  public const int GWL_EXSTYLE = -20;
  public const int WS_EX_TRANSPARENT = 0x00000020;
  public const int WS_EX_TOOLWINDOW = 0x00000080;
  public const int WS_EX_NOACTIVATE = 0x08000000;
  public const int WS_EX_LAYERED = 0x00080000;
  public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_NOMOVE = 0x0002;
  public const uint SWP_NOACTIVATE = 0x0010;
  public const uint SWP_SHOWWINDOW = 0x0040;
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")]
  public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")]
  public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  public static void MakeClickThrough(IntPtr hwnd) {
    long style = GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
    style |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED;
    SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr(style));
    SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
  }
  public static void StartReader(StreamReader reader, ConcurrentQueue<string> queue) {
    Thread thread = new Thread(() => {
      while (true) {
        string line = reader.ReadLine();
        if (line == null) {
          queue.Enqueue("quit");
          break;
        }
        queue.Enqueue(line.Trim().ToLowerInvariant());
      }
    });
    thread.IsBackground = true;
    thread.Start();
  }
}
"@

$mint = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(61, 220, 151))
$blue = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(47, 167, 255))
$glow = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(70, 47, 167, 255))
$cardBg = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(236, 10, 12, 20))
$fg = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(245, 245, 247))
$muted = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(190, 200, 210, 230))
$transparent = [System.Windows.Media.Brushes]::Transparent

$window = New-Object System.Windows.Window
$window.Title = "Cursor Wake"
$window.WindowStyle = "None"
$window.AllowsTransparency = $true
$window.Background = $transparent
$window.Topmost = $true
$window.ShowInTaskbar = $false
$window.ShowActivated = $false
$window.Focusable = $false
$window.ResizeMode = "NoResize"
$window.SizeToContent = "WidthAndHeight"
$window.MinWidth = 320

$shell = New-Object System.Windows.Controls.Border
$shell.CornerRadius = New-Object System.Windows.CornerRadius 40
$shell.Padding = New-Object System.Windows.Thickness 10
$shell.Background = $glow
$shell.Opacity = 0

$card = New-Object System.Windows.Controls.Border
$card.CornerRadius = New-Object System.Windows.CornerRadius 32
$card.Background = $cardBg
$card.Padding = New-Object System.Windows.Thickness 28, 20, 32, 20
$card.BorderBrush = $blue
$card.BorderThickness = New-Object System.Windows.Thickness 2
$card.RenderTransformOrigin = New-Object System.Windows.Point 0.5, 0.5
$script:cardScale = New-Object System.Windows.Media.ScaleTransform 1, 1
$card.RenderTransform = $script:cardScale

$row = New-Object System.Windows.Controls.StackPanel
$row.Orientation = "Horizontal"
$row.VerticalAlignment = "Center"

$dotGrid = New-Object System.Windows.Controls.Grid
$dotGrid.Width = 44
$dotGrid.Height = 44
$dotGrid.Margin = New-Object System.Windows.Thickness 0, 0, 16, 0

$halo = New-Object System.Windows.Shapes.Ellipse
$halo.Width = 44
$halo.Height = 44
$halo.Stroke = $blue
$halo.StrokeThickness = 3
$halo.Fill = $transparent
$halo.Opacity = 0.4
$halo.RenderTransformOrigin = New-Object System.Windows.Point 0.5, 0.5
$script:haloScale = New-Object System.Windows.Media.ScaleTransform 1, 1
$halo.RenderTransform = $script:haloScale

$dot = New-Object System.Windows.Shapes.Ellipse
$dot.Width = 18
$dot.Height = 18
$dot.Fill = $blue
$dot.HorizontalAlignment = "Center"
$dot.VerticalAlignment = "Center"

[void]$dotGrid.Children.Add($halo)
[void]$dotGrid.Children.Add($dot)

$textCol = New-Object System.Windows.Controls.StackPanel
$textCol.Orientation = "Vertical"
$textCol.VerticalAlignment = "Center"

$label = New-Object System.Windows.Controls.TextBlock
$label.Text = "Pode falar"
$label.Foreground = $fg
$label.FontFamily = New-Object System.Windows.Media.FontFamily "Segoe UI"
$label.FontSize = 24
$label.FontWeight = "Bold"
$label.VerticalAlignment = "Center"

$hint = New-Object System.Windows.Controls.TextBlock
$hint.Text = "Estou ouvindo"
$hint.Foreground = $muted
$hint.FontFamily = New-Object System.Windows.Media.FontFamily "Segoe UI"
$hint.FontSize = 13
$hint.Margin = New-Object System.Windows.Thickness 0, 2, 0, 0

[void]$textCol.Children.Add($label)
[void]$textCol.Children.Add($hint)
[void]$row.Children.Add($dotGrid)
[void]$row.Children.Add($textCol)
$card.Child = $row
$shell.Child = $card
$window.Content = $shell

$script:targetOpacity = 0.0
$script:pulse = $false
$script:autoHideAt = $null
$script:tick = 0
$queue = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'

function Move-ToBottomCenter {
  $wa = [System.Windows.SystemParameters]::WorkArea
  $window.Left = $wa.Left + (($wa.Width - $window.ActualWidth) / 2)
  $window.Top = $wa.Bottom - $window.ActualHeight - 36
}

function Set-HudState([string]$state) {
  $script:autoHideAt = $null
  switch ($state) {
    "hearing" {
      $label.Text = "Ouvindo"
      $hint.Text = "Manda o pedido"
      $dot.Fill = $blue
      $halo.Stroke = $blue
      $card.BorderBrush = $blue
      $shell.Background = $glow
      $script:pulse = $true
      $script:targetOpacity = 1
    }
    "transcribing" {
      $label.Text = "Transcrevendo"
      $hint.Text = "Segura ai"
      $dot.Fill = $blue
      $halo.Stroke = $blue
      $card.BorderBrush = $blue
      $shell.Background = $glow
      $script:pulse = $true
      $script:targetOpacity = 1
    }
    "armed" {
      $label.Text = "Pode falar"
      $hint.Text = "Estou ouvindo"
      $dot.Fill = $blue
      $halo.Stroke = $blue
      $card.BorderBrush = $blue
      $shell.Background = $glow
      $script:pulse = $true
      $script:targetOpacity = 1
    }
    "sent" {
      $label.Text = "Enviado"
      $hint.Text = "Foi pro Cursor"
      $dot.Fill = $mint
      $halo.Stroke = $mint
      $card.BorderBrush = $mint
      $dot.Opacity = 1
      $halo.Opacity = 0.55
      $script:pulse = $false
      $script:cardScale.ScaleX = 1
      $script:cardScale.ScaleY = 1
      $script:haloScale.ScaleX = 1
      $script:haloScale.ScaleY = 1
      $script:targetOpacity = 1
      $script:autoHideAt = [datetime]::UtcNow.AddMilliseconds(1600)
    }
    "ignored" {
      $script:pulse = $false
      $script:autoHideAt = [datetime]::UtcNow.AddMilliseconds(220)
    }
    "hide" {
      $script:pulse = $false
      $script:targetOpacity = 0
    }
    "quit" {
      $window.Close()
    }
  }
  Move-ToBottomCenter
}

$window.Add_SourceInitialized({
  $helper = New-Object System.Windows.Interop.WindowInteropHelper($window)
  [CursorWakeHudWin]::MakeClickThrough($helper.Handle)
})

$window.Add_Loaded({
  Move-ToBottomCenter
  $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
  [CursorWakeHudWin]::StartReader($reader, $queue)
})

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(16)
$timer.Add_Tick({
  $cmd = $null
  while ($queue.TryDequeue([ref]$cmd)) {
    Set-HudState $cmd
  }
  $script:tick++
  if ($script:pulse) {
    $wave = [math]::Abs([math]::Sin($script:tick * 0.14))
    $dot.Opacity = 0.45 + 0.55 * $wave
    $halo.Opacity = 0.25 + 0.7 * $wave
    $grow = 1.0 + (0.08 * $wave)
    $script:haloScale.ScaleX = $grow
    $script:haloScale.ScaleY = $grow
    $script:cardScale.ScaleX = 1.0 + (0.025 * $wave)
    $script:cardScale.ScaleY = 1.0 + (0.025 * $wave)
  }
  $current = $shell.Opacity
  $next = $current + (($script:targetOpacity - $current) * 0.22)
  if ([math]::Abs($next - $script:targetOpacity) -lt 0.02) { $next = $script:targetOpacity }
  $shell.Opacity = $next
  if ($script:autoHideAt -and [datetime]::UtcNow -ge $script:autoHideAt) {
    $script:autoHideAt = $null
    $script:pulse = $false
    $script:targetOpacity = 0
  }
})
$timer.Start()

$app = New-Object System.Windows.Application
$app.ShutdownMode = "OnMainWindowClose"
[void]$app.Run($window)
