using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace NC7WebViewHost;

/// <summary>
/// Forwards <c>nc7-cam</c> WebView2 messages to the native CAM process and
/// streams its newline-delimited JSON replies back into the page.
/// </summary>
internal sealed class NativeCamBridge : IDisposable
{
    public const string Channel = "nc7-cam";

    private readonly WebView2 _webView;
    private readonly Label _status;
    private readonly int _heapMb;
    private readonly string _appUrl;
    private readonly object _gate = new();

    private Process? _process;
    private StreamWriter? _stdin;
    private string? _cachedHello;
    private string? _missingReason;
    private bool _pageReady;
    private bool _disposed;

    public NativeCamBridge(WebView2 webView, Label status, int heapMb, string appUrl)
    {
        _webView = webView;
        _status = status;
        _heapMb = heapMb;
        _appUrl = appUrl;
    }

    public string StatusLabel { get; private set; } = "native CAM starting";

    public async Task AttachAsync()
    {
        StartService();
        await _webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BuildPrelude());
        _webView.CoreWebView2.NavigationCompleted += (_, _) =>
        {
            _pageReady = true;
            ReplayHello();
            SetStatus("page ready");
        };
        _webView.CoreWebView2.WebMessageReceived += (_, args) => OnWebMessage(args);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try
        {
            lock (_gate)
            {
                _stdin?.Close();
            }
        }
        catch
        {
            // The pipe may already be closed.
        }

        try
        {
            if (_process is { HasExited: false })
            {
                if (!_process.WaitForExit(400)) _process.Kill(entireProcessTree: true);
            }
        }
        catch
        {
            // The process may already have exited.
        }

        _process?.Dispose();
        _process = null;
    }

    private void StartService()
    {
        var path = ResolveServicePath();
        if (path == null)
        {
            StatusLabel = "native CAM not built";
            CacheHello(UnavailableHello(_missingReason ?? "nc7-cam-service was not found. Build host/native/NC7CamService."));
            return;
        }

        try
        {
            var start = new ProcessStartInfo
            {
                FileName = path,
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            _process = new Process
            {
                StartInfo = start,
                EnableRaisingEvents = true,
            };
            _process.Exited += (_, _) => OnServiceExited();
            if (!_process.Start()) throw new InvalidOperationException("nc7-cam-service did not start");

            _stdin = _process.StandardInput;
            _stdin.AutoFlush = true;
            StatusLabel = "native CAM skeleton";

            var stdout = new Thread(() => Pump(_process.StandardOutput, true))
            {
                IsBackground = true,
                Name = "nc7-cam-stdout",
            };
            var stderr = new Thread(() => Pump(_process.StandardError, false))
            {
                IsBackground = true,
                Name = "nc7-cam-stderr",
            };
            stdout.Start();
            stderr.Start();
        }
        catch (Exception ex)
        {
            StatusLabel = "native CAM failed";
            CacheHello(UnavailableHello(ex.Message));
            _process?.Dispose();
            _process = null;
            _stdin = null;
        }
    }

    private string? ResolveServicePath()
    {
        var fromEnv = Environment.GetEnvironmentVariable("NC7_CAM_SERVICE");
        if (!string.IsNullOrWhiteSpace(fromEnv))
        {
            var full = Path.GetFullPath(fromEnv.Trim());
            if (File.Exists(full)) return full;
            _missingReason = $"NC7_CAM_SERVICE does not exist: {full}";
            return null;
        }

        string[] names = ["nc7-cam-service.exe", "nc7-cam-service"];
        string[] roots =
        [
            AppContext.BaseDirectory,
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "host", "native", "NC7CamService", "build")),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "host", "native", "NC7CamService", "build")),
        ];
        foreach (var root in roots)
        {
            foreach (var name in names)
            {
                var candidate = Path.Combine(root, name);
                if (File.Exists(candidate)) return candidate;
            }
        }

        _missingReason = "nc7-cam-service was not found. Build host/native/NC7CamService or set NC7_CAM_SERVICE.";
        return null;
    }

    private static string BuildPrelude()
    {
        var script = new StringBuilder();
        script.Append("window.__NC7_HOST__=Object.assign(window.__NC7_HOST__||{},{shell:'webview2'});");
        var backend = Environment.GetEnvironmentVariable("NC7_CAM_BACKEND");
        if (backend is "native" or "worker" or "main")
        {
            script.Append("window.__NC7_CAM_BACKEND__=");
            script.Append(JsonSerializer.Serialize(backend));
            script.Append(';');
        }
        return script.ToString();
    }

    private static string UnavailableHello(string error)
    {
        return JsonSerializer.Serialize(new
        {
            channel = Channel,
            type = "hello",
            protocolVersion = 1,
            engine = "unavailable",
            engineVersion = (string?)null,
            productionReady = false,
            actions = new[] { "hello" },
            error,
        });
    }

    private void CacheHello(string hello)
    {
        lock (_gate) _cachedHello = hello;
    }

    private void OnWebMessage(CoreWebView2WebMessageReceivedEventArgs args)
    {
        string json;
        try
        {
            json = args.WebMessageAsJson;
        }
        catch
        {
            return;
        }
        if (string.IsNullOrWhiteSpace(json)) return;

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(json);
        }
        catch
        {
            return;
        }

        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.String)
            {
                SetStatus("msg: " + Trim(root.GetString(), 120));
                return;
            }
            if (root.ValueKind != JsonValueKind.Object) return;

            if (!root.TryGetProperty("channel", out var channel) || channel.GetString() != Channel)
            {
                SetStatus("msg: " + Trim(json, 120));
                return;
            }

            var action = root.TryGetProperty("action", out var actionEl) && actionEl.ValueKind == JsonValueKind.String
                ? actionEl.GetString()
                : null;

            if (action == "hello")
            {
                ReplayHello();
                return;
            }

            if (_stdin == null)
            {
                PostError(root, "Native CAM service is not running");
                return;
            }

            try
            {
                var compact = JsonSerializer.Serialize(root);
                lock (_gate)
                {
                    _stdin.WriteLine(compact);
                }
                SetStatus(action ?? "request");
            }
            catch (Exception ex)
            {
                PostError(root, "Native CAM write failed: " + ex.Message);
            }
        }
    }

    private void Pump(StreamReader reader, bool stdout)
    {
        try
        {
            string? line;
            while ((line = reader.ReadLine()) != null)
            {
                if (_disposed) return;
                if (string.IsNullOrWhiteSpace(line)) continue;
                if (!stdout)
                {
                    SetStatus("native stderr: " + Trim(line, 160));
                    continue;
                }
                OnServiceLine(line.Trim());
            }
        }
        catch (Exception ex)
        {
            if (!_disposed) SetStatus("native pipe closed: " + ex.Message);
        }
    }

    private void OnServiceLine(string line)
    {
        string? type = null;
        try
        {
            using var doc = JsonDocument.Parse(line);
            if (doc.RootElement.TryGetProperty("type", out var typeEl) && typeEl.ValueKind == JsonValueKind.String)
            {
                type = typeEl.GetString();
            }
        }
        catch
        {
            SetStatus("native sent non-JSON");
            return;
        }

        if (type == "hello")
        {
            CacheHello(line);
            StatusLabel = "native CAM skeleton";
            if (_pageReady) PostJson(line);
            SetStatus("hello");
            return;
        }

        if (_pageReady) PostJson(line);
    }

    private void OnServiceExited()
    {
        if (_disposed) return;
        int code;
        try
        {
            code = _process?.ExitCode ?? -1;
        }
        catch
        {
            code = -1;
        }
        StatusLabel = "native CAM stopped";
        SetStatus($"exited {code}");
        PostJson(JsonSerializer.Serialize(new
        {
            channel = Channel,
            type = "service-exit",
            protocolVersion = 1,
            status = "error",
            error = $"Native CAM service exited ({code})",
        }));
    }

    private void ReplayHello()
    {
        string? hello;
        lock (_gate) hello = _cachedHello;
        if (hello != null) PostJson(hello);
    }

    private void PostError(JsonElement root, string error)
    {
        var message = new JsonObject
        {
            ["channel"] = Channel,
            ["type"] = "result",
            ["status"] = "error",
            ["protocolVersion"] = 1,
            ["error"] = error,
        };
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("id", out var id))
        {
            message["id"] = JsonNode.Parse(id.GetRawText());
        }
        PostJson(message.ToJsonString());
    }

    private void PostJson(string json)
    {
        if (_disposed || _webView.IsDisposed) return;
        void Send()
        {
            if (_disposed || _webView.IsDisposed || _webView.CoreWebView2 == null) return;
            try
            {
                _webView.CoreWebView2.PostWebMessageAsJson(json);
            }
            catch
            {
                // The document may not be ready yet. NavigationCompleted replays hello.
            }
        }

        if (_webView.InvokeRequired) _webView.BeginInvoke(Send);
        else Send();
    }

    private void SetStatus(string detail)
    {
        if (_disposed || _status.IsDisposed) return;
        var text = $"WebView2 | heap={_heapMb} MB | {StatusLabel} | {Trim(detail, 180)} | {_appUrl}";
        void Apply()
        {
            if (!_status.IsDisposed) _status.Text = text;
        }

        if (_status.InvokeRequired) _status.BeginInvoke(Apply);
        else Apply();
    }

    private static string Trim(string? value, int max)
    {
        if (string.IsNullOrEmpty(value)) return "";
        var oneLine = value.Replace('\n', ' ').Replace('\r', ' ');
        return oneLine.Length <= max ? oneLine : oneLine[..max];
    }
}
