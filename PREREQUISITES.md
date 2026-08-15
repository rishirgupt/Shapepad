# Running a ShapePad release

This covers what you need **just to run a downloaded release** — not to build
from source (see [README.md](README.md) for that).

## System requirements

| Requirement | Needed? |
| --- | --- |
| **Windows 10 (version 1809+) or Windows 11, 64-bit** | Yes. The frameless/transparent window relies on Windows' compositor (DWM); this doesn't run on Windows 7/8 or 32-bit systems. |
| **WebView2 Runtime** | **No action needed.** See below. |
| **Admin rights** | **No.** The installer installs per-user by default. |
| **Internet connection during install** | **No.** See below. |
| **Microsoft Visual C++ Redistributable** | Almost certainly already on your machine. See *If it still won't start*. |

## Why there's nothing to install first

Tauri apps render their UI through **WebView2**, Microsoft's Chromium-based
runtime. Most Windows 10/11 machines already have it — it ships with Edge —
but not all do (a fresh corporate image or a stripped-down install can be
missing it), and asking a normal user to go find and install a separate
runtime before your app even opens is a bad first impression.

So the installer embeds the **full offline WebView2 installer** directly
(`bundle.windows.webviewInstallMode: offlineInstaller` in
`src-tauri/tauri.conf.json`). That's why the download is ~200MB instead of a
few MB — the tradeoff is deliberate: a bigger download that works out of the
box on any Windows 10/11 machine, with no internet access needed at install
time and nothing extra for you to install first.

## Which file to download

From the [Releases page](../../releases):

- **`ShapePad_<version>_x64-setup.exe`** (NSIS) — recommended. Smaller,
  faster, standard installer UX with an uninstaller entry in Windows Settings.
- **`ShapePad_<version>_x64_en-US.msi`** — for environments that specifically
  require MSI-based deployment (e.g. group policy / enterprise software
  distribution).

Both bundle everything above; pick either.

## First run: the SmartScreen prompt

ShapePad isn't code-signed (that requires a paid certificate), so Windows
SmartScreen will likely show **"Windows protected your PC"** the first time
you run the installer. This is expected for any small/independent unsigned
app, not a sign anything is wrong.

To proceed: click **More info**, then **Run anyway**.

If your antivirus quarantines or flags the file instead, that's a heuristic
false positive common for freshly-compiled, unsigned Rust binaries — restore
it from quarantine, or add an exception for the installer.

## If it still won't start

1. **Confirm you're on 64-bit Windows 10/11** — right-click *This PC* →
   *Properties* → check *System type*.
2. **Missing-DLL error on launch** (`vcruntime140.dll` / `msvcp140.dll` /
   similar): install the
   [Microsoft Visual C++ Redistributable (x64)](https://aka.ms/vs/17/release/vc_redist.x64.exe).
   This is part of the OS on virtually every real-world Windows 10/11
   install already, so you'd only hit this on a very bare-bones machine.
3. **Nothing happens at all when you double-click the installer** — check
   whether SmartScreen or your antivirus silently blocked it (see above),
   and check the notification area / Downloads bar for a blocked-file notice.
4. Still stuck: open an issue with what you tried and any error text —
   [Issues](../../issues).
