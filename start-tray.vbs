Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
logFile = root & "\tray.log"
cmd = "cmd /c node src\index.js --tray >> """ & logFile & """ 2>&1"
sh.Run cmd, 0, False
