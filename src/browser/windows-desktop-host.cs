using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

// A headed browser on Default can steal foreground focus even at (-32000,-32000).
// Start only that browser on a private Win32 desktop. Never switch the user's
// input desktop or manipulate their foreground window. Manual login bypasses us.
public static class FiltrsoftDesktopHost {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct StartupInfo {
        public int cb; public IntPtr reserved, desktop, title;
        public uint x,y,width,height,xChars,yChars,fill,flags;
        public ushort show,reservedBytes; public IntPtr reservedData,input,output,error;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits {
        public long processTime,jobTime; public uint flags;
        public UIntPtr minWorkingSet,maxWorkingSet; public uint activeProcesses;
        public UIntPtr affinity; public uint priority,scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong a,b,c,d,e,f; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
        public BasicLimits basic; public IoCounters io;
        public UIntPtr processMemory,jobMemory,peakProcessMemory,peakJobMemory;
    }
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern IntPtr CreateDesktopW(string name,IntPtr device,IntPtr mode,uint flags,uint access,IntPtr security);
    [DllImport("user32.dll",SetLastError=true)] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern void GetStartupInfoW(out StartupInfo info);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern bool CreateProcessW(string app,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr env,string cwd,ref StartupInfo startup,out ProcessInfo process);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr security,string name);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimits limits,uint length);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    // Windows argv quoting, including literal quotes and trailing backslashes.
    public static string Quote(string value) {
        var b=new StringBuilder("\""); int slashes=0;
        foreach(char c in value) {
            if(c=='\\'){slashes++;continue;}
            if(c=='\"'){b.Append('\\',slashes*2+1);b.Append(c);}
            else {b.Append('\\',slashes);b.Append(c);}
            slashes=0;
        }
        return b.Append('\\',slashes*2).Append('"').ToString();
    }
    static void Check(bool ok,string operation) { if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error(),operation); }

    public static int Main(string[] args) {
        IntPtr desktop=IntPtr.Zero,job=IntPtr.Zero,desktopName=IntPtr.Zero;
        var child=new ProcessInfo(); bool started=false,finished=false;
        try {
            string chrome=Environment.GetEnvironmentVariable("FILTRSOFT_DESKTOP_BROWSER");
            if(String.IsNullOrEmpty(chrome)||!Path.IsPathRooted(chrome)||!File.Exists(chrome))throw new Exception("Configured Chrome executable is missing.");
            desktop=CreateDesktopW("FiltrsoftCollector",IntPtr.Zero,IntPtr.Zero,0,0xC7,IntPtr.Zero);
            Check(desktop!=IntPtr.Zero,"Create collector desktop");
            job=CreateJobObjectW(IntPtr.Zero,null);Check(job!=IntPtr.Zero,"Create browser job");
            var limits=new ExtendedLimits(); limits.basic.flags=0x2000; // KILL_ON_JOB_CLOSE
            Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits)),"Set browser job lifetime");
            StartupInfo startup; GetStartupInfoW(out startup);
            desktopName=Marshal.StringToHGlobalUni("WinSta0\\FiltrsoftCollector");
            startup.cb=Marshal.SizeOf(startup); startup.desktop=desktopName;
            startup.title=IntPtr.Zero; startup.flags &= 0x100; // Retain inherited stdio only.
            // reservedData/reservedBytes carry Node's CRT fd 3/4 pipe handles.
            // Forward them unchanged or Playwright's debugging pipe stops working.
            var command=new StringBuilder(Quote(chrome));
            foreach(string arg in args)command.Append(' ').Append(Quote(arg));
            Check(CreateProcessW(chrome,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,null,ref startup,out child),"Start browser on collector desktop");
            started=true;
            // Suspend until owned: abrupt worker/host termination cannot orphan Chrome.
            Check(AssignProcessToJobObject(job,child.process),"Own browser process tree");
            Check(ResumeThread(child.thread)!=0xffffffff,"Resume isolated browser");
            Check(WaitForSingleObject(child.process,0xffffffff)==0,"Wait for isolated browser");
            uint code; Check(GetExitCodeProcess(child.process,out code),"Read browser exit status");
            finished=true; return unchecked((int)code);
        } catch(Exception e) { Console.Error.WriteLine("Filtrsoft browser isolation failed: "+e.Message);return 1; }
        finally {
            if(started&&!finished)TerminateProcess(child.process,1);
            if(child.thread!=IntPtr.Zero)CloseHandle(child.thread);
            if(child.process!=IntPtr.Zero)CloseHandle(child.process);
            if(job!=IntPtr.Zero)CloseHandle(job);
            if(desktop!=IntPtr.Zero)CloseDesktop(desktop);
            if(desktopName!=IntPtr.Zero)Marshal.FreeHGlobal(desktopName);
        }
    }
}
