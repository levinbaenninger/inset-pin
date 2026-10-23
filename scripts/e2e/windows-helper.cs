// Test helper for scripts/e2e/verify-windows.ts. Compiled with the C# 5 compiler that ships with
// .NET Framework 4, so it uses no newer syntax. Prints one JSON value per call.
//
// Real input is sent only while the foreground window, or the window under the click point,
// belongs to one of the process ids the caller allows.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;

static class Helper
{
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Explicit)]
    struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public INPUTUNION u; }

    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT value, int size);

    const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    const uint KEYUP = 0x2, EXTENDED = 0x1, UNICODE = 0x4;
    const uint MOVE = 0x1, LEFTDOWN = 0x2, LEFTUP = 0x4, RIGHTDOWN = 0x8, RIGHTUP = 0x10, ABSOLUTE = 0x8000, VIRTUALDESK = 0x4000;
    const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

    static readonly Dictionary<string, ushort> Named = new Dictionary<string, ushort>
    {
        {"ctrl", 0xA2}, {"alt", 0xA4}, {"shift", 0xA0}, {"win", 0x5B},
        {"escape", 0x1B}, {"enter", 0x0D}, {"tab", 0x09}, {"space", 0x20}, {"backspace", 0x08},
        {"up", 0x26}, {"down", 0x28}, {"left", 0x25}, {"right", 0x27}, {"f4", 0x73}
    };

    static readonly HashSet<ushort> Extended = new HashSet<ushort> { 0x26, 0x28, 0x25, 0x27, 0x5B };

    static string Json(string value)
    {
        var builder = new StringBuilder("\"");
        foreach (char c in value ?? "")
        {
            if (c == '"' || c == '\\') { builder.Append('\\').Append(c); }
            else if (c < 0x20) { builder.Append("\\u").Append(((int)c).ToString("x4")); }
            else { builder.Append(c); }
        }
        return builder.Append('"').ToString();
    }

    static uint PidOf(IntPtr hwnd)
    {
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        return pid;
    }

    static string Text(IntPtr hwnd)
    {
        var text = new StringBuilder(512);
        GetWindowText(hwnd, text, text.Capacity);
        return text.ToString();
    }

    static string ClassOf(IntPtr hwnd)
    {
        var text = new StringBuilder(256);
        GetClassName(hwnd, text, text.Capacity);
        return text.ToString();
    }

    /** The visible frame, without the invisible resize border that GetWindowRect includes. */
    static RECT Bounds(IntPtr hwnd)
    {
        RECT rect;
        if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out rect, Marshal.SizeOf(typeof(RECT))) != 0)
        {
            GetWindowRect(hwnd, out rect);
        }
        return rect;
    }

    static string WindowJson(IntPtr hwnd)
    {
        var r = Bounds(hwnd);
        return "{\"hwnd\":" + hwnd.ToInt64() + ",\"pid\":" + PidOf(hwnd) + ",\"title\":" + Json(Text(hwnd)) +
            ",\"cls\":" + Json(ClassOf(hwnd)) + ",\"x\":" + r.Left + ",\"y\":" + r.Top +
            ",\"width\":" + (r.Right - r.Left) + ",\"height\":" + (r.Bottom - r.Top) + "}";
    }

    static HashSet<uint> ParsePids(string list)
    {
        return new HashSet<uint>(list.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries).Select(uint.Parse));
    }

    static void RequireForeground(HashSet<uint> allowed)
    {
        var front = GetForegroundWindow();
        if (!allowed.Contains(PidOf(front)))
        {
            throw new InvalidOperationException("refusing input while " + Json(Text(front)) + " (pid " + PidOf(front) + ") is in front");
        }
    }

    static void RequireUnderPoint(HashSet<uint> allowed, int x, int y)
    {
        var point = new POINT { X = x, Y = y };
        var root = GetAncestor(WindowFromPoint(point), 2);
        if (!allowed.Contains(PidOf(root)))
        {
            throw new InvalidOperationException("refusing to click " + Json(Text(root)) + " (pid " + PidOf(root) + ") at " + x + "," + y);
        }
    }

    static void Send(params INPUT[] inputs)
    {
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length)
        {
            throw new InvalidOperationException("SendInput was blocked");
        }
    }

    static INPUT Mouse(int x, int y, uint flags)
    {
        int left = GetSystemMetrics(76), top = GetSystemMetrics(77);
        int width = GetSystemMetrics(78), height = GetSystemMetrics(79);
        var input = new INPUT { type = INPUT_MOUSE };
        input.u.mi = new MOUSEINPUT
        {
            dx = (int)Math.Round((x - left) * 65535.0 / (width - 1)),
            dy = (int)Math.Round((y - top) * 65535.0 / (height - 1)),
            dwFlags = flags | MOVE | ABSOLUTE | VIRTUALDESK
        };
        return input;
    }

    static INPUT Key(ushort vk, bool up)
    {
        var input = new INPUT { type = INPUT_KEYBOARD };
        uint flags = up ? KEYUP : 0;
        if (Extended.Contains(vk)) { flags |= EXTENDED; }
        input.u.ki = new KEYBDINPUT { wVk = vk, wScan = (ushort)MapVirtualKey(vk, 0), dwFlags = flags };
        return input;
    }

    static INPUT UnicodeKey(char c, bool up)
    {
        var input = new INPUT { type = INPUT_KEYBOARD };
        input.u.ki = new KEYBDINPUT { wScan = c, dwFlags = UNICODE | (up ? KEYUP : 0) };
        return input;
    }

    static ushort Vk(string name)
    {
        ushort vk;
        if (Named.TryGetValue(name, out vk)) { return vk; }
        if (name.Length == 1 && char.IsLetterOrDigit(name[0])) { return char.ToUpperInvariant(name[0]); }
        throw new ArgumentException("unknown key " + name);
    }

    /** A chord such as ctrl+alt+p: modifiers go down in order and come up in reverse. */
    static void Chord(string chord)
    {
        var keys = chord.Split('+').Select(Vk).ToArray();
        var inputs = keys.Select(k => Key(k, false)).Concat(keys.Reverse().Select(k => Key(k, true))).ToArray();
        Send(inputs);
    }

    static void TypeText(string text)
    {
        foreach (char c in text)
        {
            Send(UnicodeKey(c, false), UnicodeKey(c, true));
            Thread.Sleep(8);
        }
    }

    static void Focus(IntPtr hwnd)
    {
        uint ignored;
        uint mine = GetCurrentThreadId();
        uint front = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
        AttachThreadInput(mine, front, true);
        BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd);
        AttachThreadInput(mine, front, false);
    }

    static List<IntPtr> TopWindows(HashSet<uint> pids)
    {
        var found = new List<IntPtr>();
        EnumWindows((hwnd, _) =>
        {
            if (IsWindowVisible(hwnd) && pids.Contains(PidOf(hwnd))) { found.Add(hwnd); }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    static string ElementJson(AutomationElement element)
    {
        var info = element.Current;
        var r = info.BoundingRectangle;
        bool empty = r.IsEmpty || double.IsInfinity(r.X);
        return "{\"type\":" + Json(info.ControlType.ProgrammaticName.Replace("ControlType.", "")) +
            ",\"name\":" + Json(info.Name) + ",\"enabled\":" + (info.IsEnabled ? "true" : "false") +
            ",\"x\":" + (empty ? 0 : (int)Math.Round(r.X + r.Width / 2)) +
            ",\"y\":" + (empty ? 0 : (int)Math.Round(r.Y + r.Height / 2)) + "}";
    }

    /** Every named element of the process's visible windows, as UI Automation reports them. */
    static void Elements(HashSet<uint> pids)
    {
        var parts = new List<string>();
        foreach (var hwnd in TopWindows(pids))
        {
            AutomationElement root;
            try { root = AutomationElement.FromHandle(hwnd); } catch (ElementNotAvailableException) { continue; }
            foreach (AutomationElement element in root.FindAll(TreeScope.Subtree, Condition.TrueCondition))
            {
                try
                {
                    if (element.Current.Name != "") { parts.Add(ElementJson(element)); }
                }
                catch (ElementNotAvailableException) { }
            }
        }
        Console.WriteLine("[" + string.Join(",", parts) + "]");
    }

    /** Notification area buttons, including those in the overflow flyout when it is open. */
    static void TrayButtons()
    {
        var parts = new List<string>();
        var buttons = AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition);
        foreach (AutomationElement top in buttons)
        {
            string cls;
            try { cls = top.Current.ClassName; } catch (ElementNotAvailableException) { continue; }
            if (cls != "Shell_TrayWnd" && cls != "TopLevelWindowForOverflowXamlIsland" && cls != "NotifyIconOverflowWindow") { continue; }
            var condition = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button);
            foreach (AutomationElement button in top.FindAll(TreeScope.Descendants, condition))
            {
                try { parts.Add(ElementJson(button)); } catch (ElementNotAvailableException) { }
            }
        }
        Console.WriteLine("[" + string.Join(",", parts) + "]");
    }

    static AutomationElement FindTrayButton(string nameStart)
    {
        var condition = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button);
        foreach (AutomationElement top in AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition))
        {
            string cls;
            try { cls = top.Current.ClassName; } catch (ElementNotAvailableException) { continue; }
            if (cls != "Shell_TrayWnd" && cls != "TopLevelWindowForOverflowXamlIsland" && cls != "NotifyIconOverflowWindow") { continue; }
            foreach (AutomationElement button in top.FindAll(TreeScope.Descendants, condition))
            {
                try
                {
                    // The overflow flyout puts a space in front of some names.
                    if (button.Current.Name.Trim().StartsWith(nameStart, StringComparison.Ordinal)) { return button; }
                }
                catch (ElementNotAvailableException) { }
            }
        }
        return null;
    }

    /** The notification icon whose name starts with the text; opens the ^ overflow when the icon is hidden there. */
    static void TrayFind(string nameStart)
    {
        var button = FindTrayButton(nameStart);
        if (button == null)
        {
            var chevron = FindTrayButton("Show Hidden Icons");
            if (chevron == null) { throw new InvalidOperationException("no tray icon and no overflow button"); }
            var r = chevron.Current.BoundingRectangle;
            int x = (int)(r.X + r.Width / 2), y = (int)(r.Y + r.Height / 2);
            Send(Mouse(x, y, 0));
            Send(Mouse(x, y, LEFTDOWN));
            Send(Mouse(x, y, LEFTUP));
            for (int attempt = 0; attempt < 20 && button == null; attempt++)
            {
                Thread.Sleep(150);
                button = FindTrayButton(nameStart);
            }
        }
        if (button == null) { throw new InvalidOperationException("no tray icon named " + Json(nameStart) + " among " + OverflowNames()); }
        Console.WriteLine(ElementJson(button));
    }

    static string OverflowNames()
    {
        var names = new List<string>();
        foreach (AutomationElement top in AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition))
        {
            try
            {
                if (top.Current.ClassName != "TopLevelWindowForOverflowXamlIsland") { continue; }
                foreach (AutomationElement element in top.FindAll(TreeScope.Descendants, Condition.TrueCondition))
                {
                    names.Add(element.Current.ControlType.ProgrammaticName.Replace("ControlType.", "") + ":" + element.Current.Name);
                }
            }
            catch (ElementNotAvailableException) { }
        }
        return string.Join(" | ", names);
    }

    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint vk);

    /** Holds a global hotkey, as another app would, until the process is ended. */
    static void HoldHotkey(string chord)
    {
        uint modifiers = 0;
        uint vk = 0;
        foreach (var part in chord.Split('+'))
        {
            if (part == "ctrl") { modifiers |= 0x2; }
            else if (part == "alt") { modifiers |= 0x1; }
            else if (part == "shift") { modifiers |= 0x4; }
            else { vk = Vk(part); }
        }
        if (!RegisterHotKey(IntPtr.Zero, 1, modifiers | 0x4000, vk))
        {
            throw new InvalidOperationException("could not register " + chord);
        }
        Console.WriteLine("{\"ok\":true}");
        Console.Out.Flush();
        Application.Run();
    }

    /** Items of an open popup menu owned by one of the processes. */
    static void MenuItems(HashSet<uint> pids)
    {
        var parts = new List<string>();
        var condition = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem);
        foreach (AutomationElement top in AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition))
        {
            try
            {
                if (!pids.Contains((uint)top.Current.ProcessId)) { continue; }
                foreach (AutomationElement item in top.FindAll(TreeScope.Descendants, condition)) { parts.Add(ElementJson(item)); }
            }
            catch (ElementNotAvailableException) { }
        }
        Console.WriteLine("[" + string.Join(",", parts) + "]");
    }

    static void Pixel(int x, int y)
    {
        using (var bitmap = new Bitmap(1, 1))
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.CopyFromScreen(x, y, 0, 0, new Size(1, 1));
            var c = bitmap.GetPixel(0, 0);
            Console.WriteLine("{\"r\":" + c.R + ",\"g\":" + c.G + ",\"b\":" + c.B + "}");
        }
    }

    static void Shot(string file, int x, int y, int width, int height)
    {
        using (var bitmap = new Bitmap(width, height))
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.CopyFromScreen(x, y, 0, 0, new Size(width, height));
            bitmap.Save(file, ImageFormat.Png);
        }
        Console.WriteLine("{\"ok\":true}");
    }

    /** Colour of one pixel of an image file, for checking a saved crop. */
    static void FilePixel(string file, int x, int y)
    {
        using (var bitmap = new Bitmap(file))
        {
            var c = bitmap.GetPixel(x, y);
            Console.WriteLine("{\"r\":" + c.R + ",\"g\":" + c.G + ",\"b\":" + c.B + ",\"width\":" + bitmap.Width + ",\"height\":" + bitmap.Height + "}");
        }
    }

    static void Displays()
    {
        var parts = Screen.AllScreens.Select(s =>
        {
            uint dpiX = 96, dpiY = 96;
            var monitor = MonitorFromPoint(new POINT { X = s.Bounds.X + 1, Y = s.Bounds.Y + 1 }, 2);
            GetDpiForMonitor(monitor, 0, out dpiX, out dpiY);
            return "{\"x\":" + s.Bounds.X + ",\"y\":" + s.Bounds.Y + ",\"width\":" + s.Bounds.Width + ",\"height\":" + s.Bounds.Height +
                ",\"primary\":" + (s.Primary ? "true" : "false") + ",\"scale\":" + (dpiX / 96.0).ToString(CultureInfo.InvariantCulture) + "}";
        });
        Console.WriteLine("[" + string.Join(",", parts) + "]");
    }

    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT point, uint flags);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);

    static int Run(string[] a)
    {
        switch (a[0])
        {
            case "fg": Console.WriteLine(WindowJson(GetForegroundWindow())); return 0;
            case "windows":
                Console.WriteLine("[" + string.Join(",", TopWindows(ParsePids(a[1])).Select(WindowJson)) + "]");
                return 0;
            case "focus": Focus(new IntPtr(long.Parse(a[1]))); Console.WriteLine(WindowJson(GetForegroundWindow())); return 0;
            case "cursor": { POINT p; GetCursorPos(out p); Console.WriteLine("{\"x\":" + p.X + ",\"y\":" + p.Y + "}"); return 0; }
            case "move": Send(Mouse(int.Parse(a[1]), int.Parse(a[2]), 0)); Console.WriteLine("{\"ok\":true}"); return 0;
            case "click":
            case "rightclick":
            {
                int x = int.Parse(a[2]), y = int.Parse(a[3]);
                Send(Mouse(x, y, 0));
                Thread.Sleep(60);
                RequireUnderPoint(ParsePids(a[1]), x, y);
                bool right = a[0] == "rightclick";
                Send(Mouse(x, y, right ? RIGHTDOWN : LEFTDOWN));
                Thread.Sleep(30);
                Send(Mouse(x, y, right ? RIGHTUP : LEFTUP));
                Console.WriteLine("{\"ok\":true}");
                return 0;
            }
            case "keys": RequireForeground(ParsePids(a[1])); Chord(a[2]); Console.WriteLine("{\"ok\":true}"); return 0;
            case "type": RequireForeground(ParsePids(a[1])); TypeText(a[2]); Console.WriteLine("{\"ok\":true}"); return 0;
            case "elements": Elements(ParsePids(a[1])); return 0;
            case "tray": TrayButtons(); return 0;
            case "trayfind": TrayFind(a[1]); return 0;
            case "holdhotkey": HoldHotkey(a[1]); return 0;
            case "menu": MenuItems(ParsePids(a[1])); return 0;
            case "pixel": Pixel(int.Parse(a[1]), int.Parse(a[2])); return 0;
            case "shot": Shot(a[1], int.Parse(a[2]), int.Parse(a[3]), int.Parse(a[4]), int.Parse(a[5])); return 0;
            case "filepixel": FilePixel(a[1], int.Parse(a[2]), int.Parse(a[3])); return 0;
            case "displays": Displays(); return 0;
            case "pidat":
            {
                var root = GetAncestor(WindowFromPoint(new POINT { X = int.Parse(a[1]), Y = int.Parse(a[2]) }), 2);
                uint pid = PidOf(root);
                Console.WriteLine("{\"pid\":" + pid + ",\"name\":" + Json(Process.GetProcessById((int)pid).ProcessName) + "}");
                return 0;
            }
            case "clipimage":
            {
                var image = Clipboard.GetImage();
                if (image == null) { Console.WriteLine("{\"ok\":false}"); return 0; }
                image.Save(a[1], ImageFormat.Png);
                Console.WriteLine("{\"ok\":true,\"width\":" + image.Width + ",\"height\":" + image.Height + "}");
                return 0;
            }
            case "cliptext":
                Console.WriteLine(Clipboard.ContainsText() ? Json(Clipboard.GetText()) : "null");
                return 0;
            case "setcliptext":
                if (a[1] == "") { Clipboard.Clear(); } else { Clipboard.SetText(a[1]); }
                Console.WriteLine("{\"ok\":true}");
                return 0;
            default: throw new ArgumentException("unknown command " + a[0]);
        }
    }

    [STAThread]
    static int Main(string[] args)
    {
        // Per-monitor aware, so every coordinate is a physical pixel.
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        // The console's code page would turn curly quotes in window text into plain ones and break the JSON.
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            return Run(args);
        }
        catch (Exception error)
        {
            Console.WriteLine("{\"error\":" + Json(error.Message) + "}");
            return 1;
        }
    }
}
