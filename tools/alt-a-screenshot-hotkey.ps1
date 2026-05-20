$ErrorActionPreference = 'Stop'

$logDir = Join-Path $env:APPDATA 'CodexHotkeys'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir 'alt-a-snipaste-hotkey.log'

Add-Type -AssemblyName System.Windows.Forms

$source = @"
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public sealed class AltAScreenshotHotkeyForm : Form
{
    private const int HotkeyId = 0xA11A;
    private const int WmHotkey = 0x0312;
    private const uint ModAlt = 0x0001;
    private const uint ModNoRepeat = 0x4000;
    private const uint VkA = 0x41;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    public AltAScreenshotHotkeyForm()
    {
        ShowInTaskbar = false;
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        WindowState = FormWindowState.Minimized;
        Opacity = 0;

        bool registered = RegisterHotKey(Handle, HotkeyId, ModAlt | ModNoRepeat, VkA);
        if (!registered)
        {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, "Could not register Alt+A as a screenshot hotkey.");
        }

        EnsureSnipasteRunning(FindSnipastePath());
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        Hide();
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == WmHotkey && message.WParam.ToInt32() == HotkeyId)
        {
            StartSnipasteSnip();
        }

        base.WndProc(ref message);
    }

    protected override void Dispose(bool disposing)
    {
        UnregisterHotKey(Handle, HotkeyId);
        base.Dispose(disposing);
    }

    private static string FindSnipastePath()
    {
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string wingetPackages = Path.Combine(localAppData, "Microsoft", "WinGet", "Packages");
        string expected = Path.Combine(wingetPackages, "liule.Snipaste_Microsoft.Winget.Source_8wekyb3d8bbwe", "Snipaste.exe");

        if (File.Exists(expected))
        {
            return expected;
        }

        try
        {
            if (Directory.Exists(wingetPackages))
            {
                foreach (string file in Directory.GetFiles(wingetPackages, "Snipaste.exe", SearchOption.AllDirectories))
                {
                    return file;
                }
            }
        }
        catch
        {
        }

        return "Snipaste.exe";
    }

    private static bool IsSnipasteRunning()
    {
        return Process.GetProcessesByName("Snipaste").Length > 0;
    }

    private static void EnsureSnipasteRunning(string snipastePath)
    {
        if (IsSnipasteRunning())
        {
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = snipastePath,
            WorkingDirectory = Path.GetDirectoryName(snipastePath),
            UseShellExecute = false
        });
        Thread.Sleep(1500);
    }

    private static void StartSnipasteSnip()
    {
        try
        {
            string snipastePath = FindSnipastePath();
            EnsureSnipasteRunning(snipastePath);
            Process.Start(new ProcessStartInfo
            {
                FileName = snipastePath,
                Arguments = "snip",
                WorkingDirectory = Path.GetDirectoryName(snipastePath),
                UseShellExecute = false
            });
        }
        catch
        {
            try
            {
                SendKeys.SendWait("+{PRTSC}");
            }
            catch
            {
            }
        }
    }
}
"@

Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Windows.Forms.dll', 'System.Drawing.dll'

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\CodexAltAScreenshotHotkey', [ref]$createdNew)
if (-not $createdNew) {
    return
}

try {
    [System.Windows.Forms.Application]::EnableVisualStyles()
    $form = [AltAScreenshotHotkeyForm]::new()
    "$(Get-Date -Format o) Alt+A Snipaste hotkey running." | Set-Content -LiteralPath $logPath
    [System.Windows.Forms.Application]::Run($form)
}
catch {
    "$(Get-Date -Format o) $($_.Exception.Message)" | Set-Content -LiteralPath $logPath
    throw
}
finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
