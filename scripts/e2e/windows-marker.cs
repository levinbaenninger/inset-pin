// A magenta square at a known screen position: the "detail" the test points at, and the app in
// front whose focus must come back after the panel closes.
//   windows-marker.exe <x> <y> <size>
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

static class Marker
{
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [STAThread]
    static void Main(string[] args)
    {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        int x = int.Parse(args[0]), y = int.Parse(args[1]), size = int.Parse(args[2]);
        var form = new Form
        {
            BackColor = Color.Magenta,
            FormBorderStyle = FormBorderStyle.None,
            Location = new Point(x, y),
            ShowInTaskbar = true,
            Size = new Size(size, size),
            StartPosition = FormStartPosition.Manual,
            Text = "Inset e2e marker"
        };
        form.Shown += (sender, e) => form.Activate();
        Application.Run(form);
    }
}
