using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace NC7WebViewHost;

/// <summary>
/// WebView2 desktop shell for NC7 3D Freeform.
/// Heap size is controlled via NC7_WEBVIEW_HEAP_MB (4096 or 8192 recommended).
/// </summary>
internal sealed class MainForm : Form
{
    private readonly WebView2 _webView = new();
    private readonly Label _status = new() { Dock = DockStyle.Bottom, Height = 28, TextAlign = ContentAlignment.MiddleLeft };
    private NativeCamBridge? _cam;

    public MainForm()
    {
        Text = "NC7 3D Freeform";
        Width = 1280;
        Height = 800;
        StartPosition = FormStartPosition.CenterScreen;

        _status.Padding = new Padding(8, 0, 8, 0);
        Controls.Add(_webView);
        Controls.Add(_status);
        _webView.Dock = DockStyle.Fill;

        Load += async (_, _) => await InitWebViewAsync();
    }

    private async Task InitWebViewAsync()
    {
        var heapMb = ResolveHeapMb();
        var appUrl = ResolveAppUrl();
        var userData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "NC7WebViewHost",
            "UserData");

        Directory.CreateDirectory(userData);

        var options = new CoreWebView2EnvironmentOptions
        {
            AdditionalBrowserArguments = $"--js-flags=\"--max-old-space-size={heapMb}\"",
        };

        _status.Text = $"Loading… heap={heapMb} MB | {appUrl}";

        var env = await CoreWebView2Environment.CreateAsync(null, userData, options);
        await _webView.EnsureCoreWebView2Async(env);

        _webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
        _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;

        _cam = new NativeCamBridge(_webView, _status, heapMb, appUrl);
        await _cam.AttachAsync();

        _webView.CoreWebView2.Navigate(appUrl);
        _status.Text = $"Ready | js heap cap={heapMb} MB | {_cam.StatusLabel} | {appUrl}";
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _cam?.Dispose();
        _cam = null;
        base.OnFormClosed(e);
    }

    private static int ResolveHeapMb()
    {
        var raw = Environment.GetEnvironmentVariable("NC7_WEBVIEW_HEAP_MB");
        if (int.TryParse(raw, out var parsed) && parsed >= 512)
            return parsed;

        // Default for 3D CAM sessions on 8–16 GB Windows PCs.
        return 4096;
    }

    private static string ResolveAppUrl()
    {
        var fromEnv = Environment.GetEnvironmentVariable("NC7_APP_URL");
        if (!string.IsNullOrWhiteSpace(fromEnv))
            return fromEnv.Trim();

        // Production: point at built dist served locally or packaged assets.
        var distIndex = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "dist", "index.html"));
        if (File.Exists(distIndex))
            return new Uri(distIndex).AbsoluteUri;

        return "http://localhost:5173/";
    }
}
