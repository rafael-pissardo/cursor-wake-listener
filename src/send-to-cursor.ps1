param(
  [Parameter(Mandatory = $true)][string]$PromptFile,
  [Parameter(Mandatory = $true)][ValidateSet("0", "1")][string]$OpenAgent,
  [Parameter(Mandatory = $true)][ValidateSet("0", "1")][string]$Submit,
  [Parameter(Mandatory = $true)][ValidateSet("0", "1")][string]$NewChat,
  [Parameter(Mandatory = $false)][string]$NewChatHotkey = "palette"
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CursorWakeWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
}
"@

Add-Type -AssemblyName System.Windows.Forms

$VK_SHIFT = 0x10
$VK_CONTROL = 0x11
$VK_RETURN = 0x0D
$VK_A = 0x41
$VK_I = 0x49
$VK_L = 0x4C
$VK_P = 0x50
$VK_V = 0x56
$KEYUP = 2

function Send-WinChord([byte[]]$Modifiers, [byte]$Key) {
  foreach ($modifier in $Modifiers) {
    [CursorWakeWin]::keybd_event($modifier, 0, 0, 0)
  }
  Start-Sleep -Milliseconds 25
  [CursorWakeWin]::keybd_event($Key, 0, 0, 0)
  Start-Sleep -Milliseconds 25
  [CursorWakeWin]::keybd_event($Key, 0, $KEYUP, 0)
  for ($i = $Modifiers.Length - 1; $i -ge 0; $i -= 1) {
    [CursorWakeWin]::keybd_event($Modifiers[$i], 0, $KEYUP, 0)
  }
  Start-Sleep -Milliseconds 40
}

$prompt = [System.IO.File]::ReadAllText($PromptFile, [System.Text.Encoding]::UTF8)
$hasPrompt = -not [string]::IsNullOrWhiteSpace($prompt)
if (-not $hasPrompt -and $NewChat -ne "1") {
  throw "Prompt vazio"
}

$cursor = Get-Process -Name "Cursor" -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
  Select-Object -First 1

if (-not $cursor) {
  throw "Janela do Cursor nao encontrada. Abra o Cursor no Windows antes."
}

$hwnd = $cursor.MainWindowHandle
$foreground = [CursorWakeWin]::GetForegroundWindow()
$unused = 0
$fgThread = [CursorWakeWin]::GetWindowThreadProcessId($foreground, [ref]$unused)
$targetThread = [CursorWakeWin]::GetWindowThreadProcessId($hwnd, [ref]$unused)
$currentThread = [CursorWakeWin]::GetCurrentThreadId()

if ([CursorWakeWin]::IsIconic($hwnd)) {
  [void][CursorWakeWin]::ShowWindowAsync($hwnd, 9)
}

[void][CursorWakeWin]::AttachThreadInput($currentThread, $fgThread, $true)
[void][CursorWakeWin]::AttachThreadInput($currentThread, $targetThread, $true)
[void][CursorWakeWin]::BringWindowToTop($hwnd)
[void][CursorWakeWin]::SetForegroundWindow($hwnd)
[void][CursorWakeWin]::AttachThreadInput($currentThread, $targetThread, $false)
[void][CursorWakeWin]::AttachThreadInput($currentThread, $fgThread, $false)

Start-Sleep -Milliseconds 250

# Ctrl+I focuses the current Agent input, which swallows Ctrl+Shift+L.
# Skip it when opening a new chat; the palette still works from the composer.
if ($OpenAgent -eq "1" -and $NewChat -ne "1") {
  Send-WinChord @($VK_CONTROL) $VK_I
  Start-Sleep -Milliseconds 250
}

if ($NewChat -eq "1") {
  $hotkey = if ([string]::IsNullOrWhiteSpace($NewChatHotkey)) { "palette" } else { $NewChatHotkey }
  if ($hotkey -eq "palette") {
    Write-Output "new-chat: palette"
    Set-Clipboard -Value "Open New Agent Chat"
    Send-WinChord @($VK_CONTROL, $VK_SHIFT) $VK_P
    Start-Sleep -Milliseconds 550
    Send-WinChord @($VK_CONTROL) $VK_V
    Start-Sleep -Milliseconds 300
    Send-WinChord @() $VK_RETURN
    Start-Sleep -Milliseconds 900
  } else {
    Write-Output "new-chat: hotkey $hotkey"
    [System.Windows.Forms.SendKeys]::SendWait($hotkey)
    Start-Sleep -Milliseconds 800
  }
}

if (-not $hasPrompt) {
  return
}

Set-Clipboard -Value $prompt
if ($NewChat -eq "1") {
  Send-WinChord @($VK_CONTROL) $VK_A
  Start-Sleep -Milliseconds 80
}
Send-WinChord @($VK_CONTROL) $VK_V

if ($Submit -eq "1") {
  Start-Sleep -Milliseconds 80
  Send-WinChord @() $VK_RETURN
}
