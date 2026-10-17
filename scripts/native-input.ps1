param([string]$cmd, [int]$x = 0, [int]$y = 0, [int]$ms = 600)
# Real mouse control for the native walkthrough recording. Coordinates are logical (DPI-unaware) screen pixels.
Add-Type @"
using System; using System.Runtime.InteropServices;
public class M {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct P { public int X; public int Y; }
}
"@
function GoTo($tx, $ty, $dur) {
  $p = New-Object M+P
  [M]::GetCursorPos([ref]$p) | Out-Null
  $n = [Math]::Max(12, [int]($dur / 16))
  for ($i = 1; $i -le $n; $i++) {
    $t = $i / $n
    $t = $t * $t * (3 - 2 * $t)
    [M]::SetCursorPos([int]($p.X + ($tx - $p.X) * $t), [int]($p.Y + ($ty - $p.Y) * $t)) | Out-Null
    Start-Sleep -Milliseconds 16
  }
}
switch ($cmd) {
  'move' { GoTo $x $y $ms }
  'click' {
    GoTo $x $y $ms
    Start-Sleep -Milliseconds 250
    [M]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 80
    [M]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  }
  'minimize' { (New-Object -ComObject Shell.Application).MinimizeAll() }
  'restore' { (New-Object -ComObject Shell.Application).UndoMinimizeAll() }
}
